import type { Express, Request, Response, NextFunction } from "express";
import { and, asc, count, desc, eq, gt, ilike, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { lockCourseMarketplace, storage } from "./storage";
import {
  adminAuditEvents, courseMarketplaceListings, memberAdminMetadata, users, webinarLandingPages, webinars,
} from "@shared/schema";
import {
  courseMarketplaceOwnerMutationSchema, courseMarketplaceQuerySchema, courseMarketplaceReviewSchema,
} from "@shared/courseMarketplace";

function likePattern(value: string) { return `%${value.replace(/[\\%_]/g, "\\$&")}%`; }
function param(req: Request, key: string) { return String(req.params[key]); }
function paid(user: typeof users.$inferSelect | undefined) {
  return Boolean(user?.isActive && (user.isSuperAdmin || user.subscriptionPlan === "enterprise" ||
    (["active", "trialing"].includes(user.subscriptionStatus) &&
      (!user.planExpiresAt || user.planExpiresAt.getTime() > Date.now()))));
}
async function ownerGuard(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) return res.status(401).json({ message: "Unauthorized" });
  const webinar = await storage.getWebinar(param(req, "id"));
  if (!webinar || webinar.userId !== req.session.userId) {
    return res.status(403).json({ message: "Forbidden" });
  }
  next();
}
function ownerDto(row: typeof courseMarketplaceListings.$inferSelect | undefined) {
  if (!row) return null;
  return {
    webinarId: row.webinarId, optedIn: row.optedIn, status: row.status,
    rejectionReason: row.rejectionReason, approvedTitle: row.approvedTitle,
    approvedSummary: row.approvedSummary, approvedCover: row.approvedCover,
    requestedAt: row.requestedAt?.toISOString() || null, approvedAt: row.approvedAt?.toISOString() || null,
    reviewedAt: row.reviewedAt?.toISOString() || null, version: row.version,
  };
}
function landingSnapshot(webinar: typeof webinars.$inferSelect, page?: typeof webinarLandingPages.$inferSelect) {
  return {
    title: page?.publishedTitle?.trim() || webinar.title,
    summary: webinar.description?.trim() || "",
    cover: webinar.coverImage || null,
  };
}

export function registerCourseMarketplaceRoutes(app: Express) {
  app.get("/api/course-marketplace", async (req, res) => {
    const parsed = courseMarketplaceQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "Invalid query" });
    const q = parsed.data;
    const terms = [
      eq(courseMarketplaceListings.status, "approved"),
      eq(courseMarketplaceListings.optedIn, true),
      eq(webinars.publishStatus, "published"),
      eq(users.isActive, true),
      or(
        eq(users.isSuperAdmin, true),
        eq(users.subscriptionPlan, "enterprise"),
        and(
          or(eq(users.subscriptionStatus, "active"), eq(users.subscriptionStatus, "trialing")),
          or(isNull(users.planExpiresAt), gt(users.planExpiresAt, new Date())),
        ),
      )!,
    ];
    if (q.search) terms.push(or(
      ilike(courseMarketplaceListings.approvedTitle, likePattern(q.search)),
      ilike(courseMarketplaceListings.approvedSummary, likePattern(q.search)),
    )!);
    const where = and(...terms);
    const [totalRows, rows] = await Promise.all([
      db.select({ value: count() }).from(courseMarketplaceListings)
        .innerJoin(webinars, eq(webinars.id, courseMarketplaceListings.webinarId))
        .innerJoin(users, eq(users.id, courseMarketplaceListings.ownerId)).where(where),
      db.select({ listing: courseMarketplaceListings, ownerName: users.username, ownerCompany: users.companyName })
        .from(courseMarketplaceListings).innerJoin(webinars, eq(webinars.id, courseMarketplaceListings.webinarId))
        .innerJoin(users, eq(users.id, courseMarketplaceListings.ownerId)).where(where)
        .orderBy(desc(courseMarketplaceListings.approvedAt), asc(courseMarketplaceListings.webinarId))
        .limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    ]);
    const items = rows.map(row => ({
        webinarId: row.listing.webinarId, title: row.listing.approvedTitle || "", summary: row.listing.approvedSummary || "",
        cover: row.listing.approvedCover, ownerDisplayName: row.ownerName, ownerCompany: row.ownerCompany || "",
        registrationUrl: `/register/${row.listing.webinarId}`, approvedAt: row.listing.approvedAt!.toISOString(),
      }));
    res.json({ items, page: q.page, pageSize: q.pageSize, total: Number(totalRows[0]?.value || 0) });
  });

  app.get("/api/webinars/:id/course-marketplace", ownerGuard, async (req, res) => {
    const [row] = await db.select().from(courseMarketplaceListings).where(eq(courseMarketplaceListings.webinarId, param(req, "id"))).limit(1);
    res.json(ownerDto(row));
  });

  app.put("/api/webinars/:id/course-marketplace", ownerGuard, async (req, res) => {
    const input = courseMarketplaceOwnerMutationSchema.safeParse(req.body);
    if (!input.success) return res.status(400).json({ message: input.error.issues[0]?.message || "Invalid request" });
    const webinar = await storage.getWebinar(param(req, "id"));
    const owner = webinar?.userId ? await storage.getUser(webinar.userId) : undefined;
    if (!webinar) return res.status(404).json({ message: "Webinar not found" });
    if (input.data.optedIn) {
      if (webinar.publishStatus !== "published") return res.status(409).json({ message: "Webinar must be published" });
      if (!paid(owner)) return res.status(403).json({ message: "A paid entitlement is required" });
    }
    const now = new Date();
    try {
      const updated = await db.transaction(async tx => {
        await lockCourseMarketplace(tx, webinar.id);
        const [existing] = await tx.select().from(courseMarketplaceListings).where(eq(courseMarketplaceListings.webinarId, webinar.id)).for("update").limit(1);
        if (!input.data.optedIn) {
          if (!existing) return undefined;
          const [row] = await tx.update(courseMarketplaceListings).set({ optedIn: false, status: "withdrawn", updatedAt: now, version: existing.version + 1 })
            .where(and(eq(courseMarketplaceListings.id, existing.id), eq(courseMarketplaceListings.version, existing.version))).returning();
          if (!row) throw Object.assign(new Error("Listing changed"), { status: 409 });
          return row;
        }
        if (existing) {
          const [row] = await tx.update(courseMarketplaceListings).set({ optedIn: true, status: "pending", rejectionReason: null, requestedAt: now, reviewedAt: null, reviewedBy: null, updatedAt: now, version: existing.version + 1 })
            .where(and(eq(courseMarketplaceListings.id, existing.id), eq(courseMarketplaceListings.version, existing.version))).returning();
          if (!row) throw Object.assign(new Error("Listing changed"), { status: 409 });
          return row;
        }
        return (await tx.insert(courseMarketplaceListings).values({ webinarId: webinar.id, ownerId: webinar.userId!, optedIn: true, status: "pending", requestedAt: now, approvedTitle: null, approvedSummary: null, approvedCover: null }).returning())[0];
      });
      return res.status(updated ? (input.data.optedIn ? 200 : 200) : 200).json(ownerDto(updated));
    } catch (error: any) {
      if (error?.code === "23505" || error?.status === 409) return res.status(409).json({ message: "Listing changed concurrently; retry" });
      throw error;
    }
  });

  const requireReview = async (req: Request, res: Response, next: NextFunction) => {
    if (!req.session?.userId) return res.status(401).json({ message: "Unauthorized" });
    const user = await storage.getUser(req.session.userId);
    const [meta] = user ? await db.select().from(memberAdminMetadata).where(eq(memberAdminMetadata.userId, user.id)).limit(1) : [];
    if (!user?.isActive || (!user.isSuperAdmin && meta?.managementRole !== "super_admin")) return res.status(403).json({ message: "Forbidden" });
    next();
  };
  app.get("/api/management/course-marketplace", requireReview, async (req, res) => {
    const rows = await db.select({ listing: courseMarketplaceListings, webinar: webinars, owner: users })
      .from(courseMarketplaceListings).innerJoin(webinars, eq(webinars.id, courseMarketplaceListings.webinarId))
      .innerJoin(users, eq(users.id, courseMarketplaceListings.ownerId))
      .where(eq(courseMarketplaceListings.status, "pending")).orderBy(asc(courseMarketplaceListings.requestedAt));
    res.json({ items: rows.map(r => ({ ...r.listing, webinarTitle: r.webinar.title, ownerName: r.owner.username, ownerCompany: r.owner.companyName || "" })) });
  });
  const reviewHandler = async (req: Request, res: Response) => {
    const input = courseMarketplaceReviewSchema.safeParse(req.body);
    if (!input.success) return res.status(400).json({ message: input.error.issues[0]?.message || "Invalid request" });
    const reviewer = req.session.userId!;
    const result = await db.transaction(async tx => {
      const [seed] = await tx.select().from(courseMarketplaceListings).where(eq(courseMarketplaceListings.id, param(req, "id"))).limit(1);
      if (!seed) throw Object.assign(new Error("Listing is no longer current"), { status: 409 });
      await lockCourseMarketplace(tx, seed.webinarId);
      const [listing] = await tx.select().from(courseMarketplaceListings).where(eq(courseMarketplaceListings.id, seed.id)).for("update").limit(1);
      const [webinar] = await tx.select().from(webinars).where(eq(webinars.id, seed.webinarId)).limit(1);
      const [owner] = webinar?.userId ? await tx.select().from(users).where(eq(users.id, webinar.userId)).limit(1) : [];
      if (!listing || listing.status !== "pending" || listing.version !== input.data.version ||
        !webinar || webinar.publishStatus !== "published" || !listing.optedIn || !paid(owner)) {
        throw Object.assign(new Error("Current publication or entitlement is invalid"), { status: 409 });
      }
      const [page] = await tx.select().from(webinarLandingPages).where(and(eq(webinarLandingPages.webinarId, webinar.id), eq(webinarLandingPages.status, "published"))).limit(1);
      const snap = landingSnapshot(webinar, page);
      const now = new Date();
      const patch = input.data.action === "approve"
        ? { status: "approved" as const, approvedTitle: snap.title, approvedSummary: snap.summary, approvedCover: snap.cover, approvedAt: now, rejectionReason: null }
        : { status: "rejected" as const, rejectionReason: input.data.reason!, approvedAt: null };
      const [updated] = await tx.update(courseMarketplaceListings).set({ ...patch, reviewedBy: reviewer, reviewedAt: now, updatedAt: now, version: listing.version + 1 })
        .where(and(eq(courseMarketplaceListings.id, listing.id), eq(courseMarketplaceListings.status, "pending"), eq(courseMarketplaceListings.version, listing.version))).returning();
      if (!updated) throw Object.assign(new Error("Listing changed during review"), { status: 409 });
      await tx.insert(adminAuditEvents).values({ actorUserId: reviewer, targetUserId: listing.ownerId, action: `course_marketplace.${input.data.action}`, reason: input.data.reason || "approved", before: { status: listing.status, version: listing.version }, after: { status: updated.status, version: updated.version } });
      return updated;
    });
    res.json(ownerDto(result));
  };
  app.post("/api/management/course-marketplace/:id/review", requireReview, reviewHandler);
  for (const action of ["approve", "reject"] as const) {
    app.post(`/api/management/course-marketplace/:id/${action}`, requireReview, (req, res) => {
      req.body = { ...(req.body || {}), action };
      return reviewHandler(req, res);
    });
  }
}