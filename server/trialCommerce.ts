import type { Express, RequestHandler } from "express";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  analyticsVisitorTokenSchema,
  ecpayConnections,
  noCardTrials,
  offerSalesPages,
  trialCommerceLeads,
  trialCommercePages,
  trialCommerceViewEvents,
  TRIAL_COMMERCE_BRAND,
  TRIAL_COMMERCE_LEAD_CAPTURE,
  trialCommerceLeadInputSchema,
  trialCommercePageQuerySchema,
  users,
  webinarOffers,
} from "@shared/schema";
import { getActiveNoCardTrial } from "./noCardTrial";
import { db } from "./db";
import { sha256 } from "./funnelAnalytics";
import { postgresRateLimit } from "./rateLimit";
import { normalizeCheckoutSettings } from "./salesPages";
import { activePublishingOverride } from "./adminManagementRoutes";
import { activeMemberManualPlan } from "./manualPlanEntitlements";

type TrialSalesPageInput = {
  slug: string;
  title: string;
  blocks: unknown[];
  checkoutSettings: unknown;
};

const publicViewSchema = z.object({
  visitorToken: analyticsVisitorTokenSchema,
  dedupeKey: z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9_.:-]+$/),
}).strict();

const publicSlugSchema = z.string().trim().min(3).max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export class TrialCommerceLimitError extends Error {
  constructor() {
    super("A no-card trial is limited to one product page");
    this.name = "TrialCommerceLimitError";
  }
}

export async function hasActiveNoCardTrial(userId: string): Promise<boolean> {
  return Boolean(await getActiveNoCardTrial(userId));
}

/**
 * Creates the normal offer_sales_pages row and its one-page trial fence in one
 * transaction. The advisory lock makes the business rule true even when two
 * browser tabs (or two app servers) race the same owner.
 *
 * `undefined` means the caller is not in an active no-card trial and should
 * continue through the ordinary paid-commerce creation path.
 */
export async function createTrialCommerceSalesPage(
  ownerId: string,
  offer: { id: string; webinarId: string | null },
  input: TrialSalesPageInput,
) {
  return db.transaction(async (tx) => {
    // Match the entitlement module's lock key so trial activation and this
    // first page cannot pass each other in opposite transactions.
    await tx.execute(sql`
      SELECT pg_advisory_xact_lock(hashtext(${`no-card-trial:${ownerId}`}))
    `);
    await tx.execute(sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${`trial-commerce:${ownerId}`}, 0))
    `);
    const [activeTrial] = await tx.select({ userId: noCardTrials.userId })
      .from(noCardTrials)
      .where(and(
        eq(noCardTrials.userId, ownerId),
        sql`${noCardTrials.startsAt} <= now()`,
        sql`${noCardTrials.expiresAt} > now()`,
      ))
      .limit(1);
    if (!activeTrial) return undefined;
    // A real paid/manual grant wins over a still-unexpired no-card row. The
    // latter remains historical evidence, not a cap on paid commerce.
    if (await hasPaidOrManualCommerceEntitlement(ownerId)) return undefined;
    const [existing] = await tx.select({ id: trialCommercePages.id })
      .from(trialCommercePages)
      .where(eq(trialCommercePages.ownerId, ownerId))
      .limit(1);
    if (existing) throw new TrialCommerceLimitError();

    const [page] = await tx.insert(offerSalesPages).values({
      userId: ownerId,
      webinarId: offer.webinarId,
      offerId: offer.id,
      slug: input.slug,
      title: input.title,
      orderedBlocks: input.blocks,
      checkoutSettings: normalizeCheckoutSettings(input.checkoutSettings),
    }).returning();
    await tx.insert(trialCommercePages).values({
      ownerId,
      offerId: offer.id,
      salesPageId: page.id,
    });
    return page;
  });
}

/** Fails closed for active trials; paid/non-trial publication is unchanged. */
export async function assertTrialCommercePublication(ownerId: string, salesPageId: string) {
  if (await hasPaidOrManualCommerceEntitlement(ownerId)) return;
  if (!await hasActiveNoCardTrial(ownerId)) return;
  const [ownedTrialPage] = await db.select({ id: trialCommercePages.id })
    .from(trialCommercePages)
    .where(and(
      eq(trialCommercePages.ownerId, ownerId),
      eq(trialCommercePages.salesPageId, salesPageId),
    ))
    .limit(1);
  if (!ownedTrialPage) throw new TrialCommerceLimitError();
}

async function publishedTrialPage(slug: string) {
  const [row] = await db.select({
    trialPage: trialCommercePages,
    page: offerSalesPages,
    offer: webinarOffers,
  }).from(trialCommercePages)
    .innerJoin(offerSalesPages, eq(trialCommercePages.salesPageId, offerSalesPages.id))
    .innerJoin(webinarOffers, eq(trialCommercePages.offerId, webinarOffers.id))
    .where(and(
      eq(offerSalesPages.slug, slug),
      eq(offerSalesPages.status, "published"),
      eq(webinarOffers.active, true),
      isNull(offerSalesPages.deletedAt),
    ))
    .limit(1);
  return row;
}

export async function hasPaidOrManualCommerceEntitlement(ownerId: string) {
  const [owner] = await db.select().from(users).where(eq(users.id, ownerId)).limit(1);
  if (!owner?.isActive) return false;
  if (owner.isSuperAdmin || owner.subscriptionPlan === "enterprise") return true;
  if (["active", "trialing"].includes(owner.subscriptionStatus)
    && (!owner.planExpiresAt || owner.planExpiresAt.getTime() > Date.now())) return true;
  return Boolean(await activeMemberManualPlan(owner.id) || await activePublishingOverride(owner.id));
}

async function hasConfiguredEcpayPayment(
  ownerId: string,
  offer: { paymentProvider: string; ecpayItemName: string | null; ecpayAmountTwd: number | null },
) {
  if (offer.paymentProvider !== "ecpay" || !offer.ecpayItemName || !offer.ecpayAmountTwd) return false;
  const [connection] = await db.select({ id: ecpayConnections.id })
    .from(ecpayConnections)
    .where(and(
      eq(ecpayConnections.userId, ownerId),
      eq(ecpayConnections.enabled, true),
      isNotNull(ecpayConnections.verifiedAt),
    ))
    .limit(1);
  return Boolean(connection);
}

type TrialPublicMode = "lead_capture" | "paid_checkout" | "expired" | "unavailable";

async function trialPublicMode(
  row: NonNullable<Awaited<ReturnType<typeof publishedTrialPage>>>,
): Promise<TrialPublicMode> {
  const [owner] = await db.select({ isActive: users.isActive })
    .from(users).where(eq(users.id, row.trialPage.ownerId)).limit(1);
  // A no-card row is not itself public authorization. Account suspension and
  // deletion take priority over all public trial/paid page states.
  if (!owner?.isActive) return "unavailable";
  // A paid/manual entitlement has priority even when its historical no-card
  // trial has not yet reached its original expiration timestamp.
  if (await hasPaidOrManualCommerceEntitlement(row.trialPage.ownerId)) {
    return await hasConfiguredEcpayPayment(row.trialPage.ownerId, row.offer)
      ? "paid_checkout"
      : "lead_capture";
  }
  return await hasActiveNoCardTrial(row.trialPage.ownerId) ? "lead_capture" : "expired";
}

function publicTrialPageDto(
  row: NonNullable<Awaited<ReturnType<typeof publishedTrialPage>>>,
  trialBrandingRequired: boolean,
) {
  const checkout = normalizeCheckoutSettings(row.page.publishedCheckoutSettings);
  const {
    successButtonUrl: _successButtonUrl,
    successTitle: _successTitle,
    successMessage: _successMessage,
    successButtonLabel: _successButtonLabel,
    ...publicCheckoutSettings
  } = checkout;
  return {
    id: row.page.id,
    webinarId: row.page.webinarId,
    offerId: row.page.offerId,
    slug: row.page.slug,
    title: row.page.title,
    // Always a platform route. Trial commerce deliberately has no custom-domain
    // or host-alias path; clients resolve this against their current platform
    // origin rather than inventing wildcard DNS.
    platformUrl: `/sales/${encodeURIComponent(row.page.slug)}`,
    blocks: row.page.publishedOrderedBlocks ?? [],
    checkoutSettings: publicCheckoutSettings,
    publishedAt: row.page.publishedAt,
    offer: {
      // A no-card trial never initiates a provider checkout. The price remains
      // display-only, while the required lead capture replaces payment.
      paymentProvider: "lead_capture" as const,
      checkoutMode: "lead_capture" as const,
      name: row.offer.ecpayItemName || row.page.title,
      amountMinor: row.offer.ecpayAmountTwd === null ? null : row.offer.ecpayAmountTwd * 100,
      currency: "TWD",
    },
    // Paid owners without a verified merchant still receive a working
    // lead-capture page, but no longer have a trial-only branding requirement.
    trialBrandingRequired,
    brand: TRIAL_COMMERCE_BRAND,
    leadCapture: {
      ...TRIAL_COMMERCE_LEAD_CAPTURE,
      endpoint: `/api/trial-commerce/sales-pages/${encodeURIComponent(row.page.slug)}/leads`,
    },
  };
}

function expiredTrialPageDto(row: NonNullable<Awaited<ReturnType<typeof publishedTrialPage>>>) {
  return {
    code: "TRIAL_EXPIRED" as const,
    status: "paused" as const,
    message: "This no-card trial sales page is paused.",
    slug: row.page.slug,
    platformUrl: `/sales/${encodeURIComponent(row.page.slug)}`,
  };
}

async function publishedTrialPageByIds(offerId: string, salesPageId: string) {
  const [row] = await db.select({
    trialPage: trialCommercePages,
    page: offerSalesPages,
    offer: webinarOffers,
  }).from(trialCommercePages)
    .innerJoin(offerSalesPages, eq(trialCommercePages.salesPageId, offerSalesPages.id))
    .innerJoin(webinarOffers, eq(trialCommercePages.offerId, webinarOffers.id))
    .where(and(
      eq(trialCommercePages.offerId, offerId),
      eq(trialCommercePages.salesPageId, salesPageId),
      eq(offerSalesPages.status, "published"),
      eq(webinarOffers.active, true),
      isNull(offerSalesPages.deletedAt),
    ))
    .limit(1);
  return row;
}

/** Blocks generic checkout/event APIs while this page's truthful mode is lead capture. */
export async function isLeadCaptureOnlyTrialCommercePage(offerId: string, salesPageId: string) {
  const row = await publishedTrialPageByIds(offerId, salesPageId);
  return Boolean(row && await trialPublicMode(row) === "lead_capture");
}

async function ownerTrialPage(ownerId: string) {
  const [row] = await db.select({ trialPage: trialCommercePages, page: offerSalesPages })
    .from(trialCommercePages)
    .innerJoin(offerSalesPages, eq(trialCommercePages.salesPageId, offerSalesPages.id))
    .where(eq(trialCommercePages.ownerId, ownerId))
    .limit(1);
  return row;
}

const trialLeadRateLimit = postgresRateLimit({
  namespace: "trial-commerce-lead",
  limit: 10,
  windowSeconds: 60,
});
const trialViewRateLimit = postgresRateLimit({
  namespace: "trial-commerce-view",
  limit: 120,
  windowSeconds: 60,
});

/**
 * Registers only the trial additions. Existing product and sales-page editor
 * endpoints remain canonical; this module never creates a parallel editor.
 */
export function registerTrialCommerceRoutes(
  app: Express,
  requireAdmin: RequestHandler,
) {
  // Product/sales workbench handlers are registered before this middleware.
  // Keep ordinary webinar draft/list/AI workbench access intact, while the
  // advanced analytics, export, external-integration and embed surfaces below
  // cannot become paid-feature bypasses merely because UI controls are hidden.
  app.use(async (req: any, res, next) => {
    const ownerId = req.session?.userId;
    if (!ownerId || !await hasActiveNoCardTrial(ownerId)
      || await hasPaidOrManualCommerceEntitlement(ownerId)) return next();
    const blocked = req.path === "/api/webinars/stats/summary"
      || /^\/api\/webinars\/[^/]+\/(?:funnel-analytics|analytics|registrations\/export|external-journey|external-referrals|webhooks)(?:\/|$)/.test(req.path)
      || /^\/api\/member\/external-(?:orders|journeys)(?:\/|$)/.test(req.path)
      || req.path.startsWith("/api/external")
      || req.path.startsWith("/embed/");
    if (!blocked) return next();
    return res.status(403).json({
      code: "TRIAL_FEATURE_UNAVAILABLE",
      message: "This feature is unavailable during a no-card trial",
    });
  });

  // These are browser-facing public endpoints, including pages embedded only
  // through the platform URL. Keep their CORS policy as narrow as the existing
  // public sales-page API (content type only; no credentials).
  app.use("/api/trial-commerce/sales-pages", (req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.sendStatus(200);
    next();
  });

  // Defend the generic slug-shaped endpoints as well as the canonical
  // /api/products/:offerId routes. A client cannot turn a lead-only page into
  // payment or generic funnel tracking by choosing a different URL shape.
  const rejectLeadOnlyGenericOperation = async (req: any, res: any, next: any) => {
    try {
      const parsed = publicSlugSchema.safeParse(req.params.slug);
      if (!parsed.success) return next();
      const row = await publishedTrialPage(parsed.data);
      if (!row) return next();
      const mode = await trialPublicMode(row);
      if (mode === "unavailable") return res.status(404).json({ message: "Sales page not found" });
      if (mode === "expired") return res.status(410).json(expiredTrialPageDto(row));
      if (mode === "lead_capture") {
        return res.status(409).json({
          code: "TRIAL_LEAD_CAPTURE_ONLY",
          message: "This sales page accepts leads instead of checkout or generic events",
        });
      }
      next();
    } catch (error) {
      next(error);
    }
  };
  app.post("/api/sales-pages/:slug/checkout", rejectLeadOnlyGenericOperation);
  app.post("/api/sales-pages/:slug/events", rejectLeadOnlyGenericOperation);

  // This intentionally precedes the established public sales-page route. A
  // trial row receives the stricter lead-capture DTO; non-trial and paid pages
  // continue to the existing handler unchanged.
  app.get("/api/sales-pages/:slug", async (req, res, next) => {
    try {
      const parsed = publicSlugSchema.safeParse(req.params.slug);
      if (!parsed.success) return next();
      const row = await publishedTrialPage(parsed.data);
      if (!row) return next();
      const mode = await trialPublicMode(row);
      if (mode === "paid_checkout") return next();
      if (mode === "unavailable") return res.status(404).json({ message: "Sales page not found" });
      if (mode === "expired") return res.status(410).json(expiredTrialPageDto(row));
      res.json(publicTrialPageDto(
        row,
        !await hasPaidOrManualCommerceEntitlement(row.trialPage.ownerId)
          && await hasActiveNoCardTrial(row.trialPage.ownerId),
      ));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/trial-commerce/sales-pages/:slug/leads", trialLeadRateLimit, async (req, res) => {
    try {
      const slug = publicSlugSchema.parse(req.params.slug);
      const input = trialCommerceLeadInputSchema.parse(req.body);
      const row = await publishedTrialPage(slug);
      if (!row) return res.status(404).json({ message: "Sales page not found" });
      const mode = await trialPublicMode(row);
      if (mode === "unavailable") return res.status(404).json({ message: "Sales page not found" });
      if (mode === "paid_checkout") return res.status(409).json({ message: "Lead capture is unavailable after payment is configured" });
      if (mode === "expired") return res.status(410).json(expiredTrialPageDto(row));
      const [lead] = await db.insert(trialCommerceLeads).values({
        trialCommercePageId: row.trialPage.id,
        ownerId: row.trialPage.ownerId,
        salesPageId: row.page.id,
        name: input.name,
        email: input.email,
        normalizedEmail: input.email,
        consentedAt: new Date(),
      }).onConflictDoNothing().returning({ id: trialCommerceLeads.id });
      res.status(lead ? 201 : 200).json({ accepted: true, deduplicated: !lead });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.post("/api/trial-commerce/sales-pages/:slug/events", trialViewRateLimit, async (req, res) => {
    try {
      const slug = publicSlugSchema.parse(req.params.slug);
      const input = publicViewSchema.parse(req.body);
      const row = await publishedTrialPage(slug);
      if (!row) return res.status(404).json({ message: "Sales page not found" });
      const mode = await trialPublicMode(row);
      if (mode === "unavailable") return res.status(404).json({ message: "Sales page not found" });
      if (mode === "paid_checkout") return res.status(409).json({ message: "Lead-capture events are unavailable after payment is configured" });
      if (mode === "expired") return res.status(410).json(expiredTrialPageDto(row));
      const [event] = await db.insert(trialCommerceViewEvents).values({
        trialCommercePageId: row.trialPage.id,
        ownerId: row.trialPage.ownerId,
        salesPageId: row.page.id,
        visitorTokenHash: sha256(input.visitorToken),
        dedupeKey: sha256(`trial-commerce:${row.trialPage.id}:${input.dedupeKey}`),
      }).onConflictDoNothing().returning({ id: trialCommerceViewEvents.id });
      res.status(event ? 202 : 200).json({ accepted: true, deduplicated: !event });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/trial-commerce/leads", requireAdmin, async (req: any, res) => {
    try {
      const input = trialCommercePageQuerySchema.parse(req.query);
      const ownerId = req.session.userId as string;
      const page = await ownerTrialPage(ownerId);
      if (!page) return res.json({ items: [], page: input.page, pageSize: input.pageSize, total: 0 });
      const [{ count }] = await db.select({ count: sql<number>`count(*)::int` })
        .from(trialCommerceLeads)
        .where(eq(trialCommerceLeads.trialCommercePageId, page.trialPage.id));
      const items = await db.select({
        id: trialCommerceLeads.id,
        name: trialCommerceLeads.name,
        email: trialCommerceLeads.email,
        consentedAt: trialCommerceLeads.consentedAt,
        createdAt: trialCommerceLeads.createdAt,
      }).from(trialCommerceLeads)
        .where(eq(trialCommerceLeads.trialCommercePageId, page.trialPage.id))
        .orderBy(desc(trialCommerceLeads.createdAt))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize);
      res.json({ items, page: input.page, pageSize: input.pageSize, total: Number(count) });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/trial-commerce/stats", requireAdmin, async (req: any, res) => {
    try {
      const page = await ownerTrialPage(req.session.userId as string);
      if (!page) return res.json({ visitors: 0, leads: 0, conversion: 0 });
      const [views] = await db.select({
        visitors: sql<number>`count(DISTINCT ${trialCommerceViewEvents.visitorTokenHash})::int`,
      }).from(trialCommerceViewEvents)
        .where(eq(trialCommerceViewEvents.trialCommercePageId, page.trialPage.id));
      const [leads] = await db.select({ leads: sql<number>`count(*)::int` })
        .from(trialCommerceLeads)
        .where(eq(trialCommerceLeads.trialCommercePageId, page.trialPage.id));
      const visitors = Number(views.visitors);
      const leadCount = Number(leads.leads);
      res.json({
        visitors,
        leads: leadCount,
        conversion: visitors === 0 ? 0 : Number(((leadCount / visitors) * 100).toFixed(2)),
      });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });
}