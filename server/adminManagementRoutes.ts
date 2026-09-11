import type { Express, Request, RequestHandler } from "express";
import crypto from "node:crypto";
import { and, asc, count, desc, eq, gte, ilike, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  adminAuditEvents, adminMutationIdempotency, aiCreditLots, aiPointTransactions,
  entitlementOverrides, memberAdminMetadata, registrations, supportFeedback,
  users, webinarOffers, webinarPayments, webinars,
} from "@shared/schema";
import {
  managementPermissions, managementRoles, type ManagementPermission,
  type ManagementRole,
} from "@shared/adminManagement";
import { memberManualPlanKeys, type MemberManualPlanKey } from "@shared/memberManualPlans";
import { db } from "./db";
import { storage } from "./storage";
import { appBaseUrl, sendTransactionalMail } from "./mail";
import { createRawToken, hashToken } from "./security";
import { getUncachableStripeClient } from "./stripeClient";
import { SUBSCRIPTION_PLANS } from "./subscriptionEntitlements";
import { composePublishingOverride, effectiveMemberPlan, manualPlanDto, memberManualPlan } from "./manualPlanEntitlements";
import { getNoCardTrialStatus } from "./noCardTrial";

type Actor = { id: string; role: ManagementRole; permissions: Set<ManagementPermission>; isRoot: boolean };
type SessionRequest = Request & { session: { userId?: string } };
type RevokeSessions = (userId: string) => Promise<void>;

const allPermissions = [...managementPermissions] as ManagementPermission[];
export const MANAGEMENT_ROLE_PERMISSIONS: Record<ManagementRole, ManagementPermission[]> = {
  member: [],
  read_only: ["members.read", "subscriptions.read", "billing.read", "credits.read", "support.read", "audit.read"],
  support: ["members.read", "members.write", "support.read", "support.write"],
  billing: ["members.read", "subscriptions.read", "subscriptions.write", "billing.read", "billing.refund", "credits.read", "credits.grant"],
  super_admin: allPermissions,
};
const pageSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(200).optional(),
  userId: z.string().uuid().optional(),
}).strict();
export const memberListQuerySchema = pageSchema.extend({
  role: z.enum(managementRoles).optional(),
  // z.coerce.boolean("false") is true; query strings need an explicit parser.
  active: z.enum(["true", "false"]).transform(value => value === "true").optional(),
  plan: z.string().trim().max(60).optional(),
});
const reason = z.string().trim().min(1).max(1000);
const uuid = z.string().uuid();

function issue(res: any, parsed: z.SafeParseReturnType<unknown, unknown>) {
  if (!parsed.success) res.status(400).json({ message: parsed.error.issues[0]?.message || "Invalid request" });
  return parsed.success;
}
function iso(date: Date | null | undefined) { return date?.toISOString() || null; }
function likePattern(value: string) { return `%${value.replace(/[\\%_]/g, "\\$&")}%`; }
function roleFor(user: typeof users.$inferSelect, assignedRole: ManagementRole = "member"): ManagementRole {
  return user.isSuperAdmin ? "super_admin" : assignedRole;
}
function actorFor(user: typeof users.$inferSelect, assignedRole: ManagementRole = "member"): Actor {
  const role = roleFor(user, assignedRole);
  return { id: user.id, role, permissions: new Set(MANAGEMENT_ROLE_PERMISSIONS[role]), isRoot: user.isSuperAdmin };
}
function can(actor: Actor, permission: ManagementPermission) { return actor.permissions.has(permission); }
function memberDto(user: typeof users.$inferSelect, webinarCount = 0, notes: string[] = [], tags: string[] = [], includeSubscription = false, includeCredits = false, assignedRole: ManagementRole = "member") {
  return {
    id: user.id, username: user.username, email: user.email, companyName: user.companyName || "",
    isActive: user.isActive, protectedRoot: user.isSuperAdmin, managementRole: roleFor(user, assignedRole),
    ...(includeSubscription ? { subscriptionPlan: user.subscriptionPlan, subscriptionStatus: user.subscriptionStatus, planExpiresAt: iso(user.planExpiresAt) } : {}),
    ...(includeCredits ? { aiPoints: user.aiPoints } : {}),
    createdAt: iso(user.createdAt), webinarCount, emailVerificationRequired: user.emailVerificationRequired,
    emailVerifiedAt: iso(user.emailVerifiedAt), notes, tags,
  };
}
function overrideDto(row: typeof entitlementOverrides.$inferSelect) {
  return { id: row.id, userId: row.userId, publishingSlots: row.publishingSlots, startsAt: row.startsAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(), reason: row.reason, createdAt: row.createdAt.toISOString(), createdBy: row.createdBy };
}

/** Checked at each admission, never cached, so an expired override cannot persist. */
export async function activePublishingOverride(userId: string, now = new Date()) {
  const [row] = await db.select().from(entitlementOverrides).where(and(
    eq(entitlementOverrides.userId, userId), isNull(entitlementOverrides.manualPlan),
    isNull(entitlementOverrides.revokedAt), lte(entitlementOverrides.startsAt, now), gte(entitlementOverrides.expiresAt, now),
  )).orderBy(desc(entitlementOverrides.publishingSlots), desc(entitlementOverrides.expiresAt)).limit(1);
  return row;
}

function idempotencyFingerprint(value: unknown) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function storedPaidEntitlement(user: typeof users.$inferSelect) {
  const active = user.isSuperAdmin || user.subscriptionPlan === "enterprise" || (
    ["active", "trialing"].includes(user.subscriptionStatus)
    && (!user.planExpiresAt || user.planExpiresAt.getTime() > Date.now())
  );
  return {
    plan: (user.isSuperAdmin ? "enterprise" : user.subscriptionPlan) as any,
    status: user.subscriptionStatus, active, amountUsd: null, maxWebinars: active ? user.maxWebinars : 0,
    addonWebinars: user.addonWebinars, startedAt: user.subscriptionStartedAt,
    currentPeriodEnd: user.planExpiresAt, cancelAtPeriodEnd: user.cancelAtPeriodEnd,
    stripeSubscriptionId: user.stripeSubscriptionId,
  };
}

const idempotencyKey = z.string().trim().min(8).max(100).regex(/^[A-Za-z0-9_.:-]+$/);
const manualPlanInput = z.enum(memberManualPlanKeys);
const manualPlanDate = z.coerce.date().refine(date => Number.isFinite(date.getTime()), "Invalid date");
const createManualPlanSchema = z.object({
  plan: manualPlanInput, startsAt: manualPlanDate, expiresAt: manualPlanDate, reason, idempotencyKey,
}).strict();
const updateManualPlanSchema = z.object({
  plan: manualPlanInput.optional(), startsAt: manualPlanDate.optional(), expiresAt: manualPlanDate.optional(),
  extendHours: z.number().int().min(1).max(43_800).optional(), reason, version: z.number().int().min(1),
  idempotencyKey,
}).strict().refine(value => value.plan !== undefined || value.startsAt !== undefined || value.expiresAt !== undefined || value.extendHours !== undefined, "A plan, schedule, or extension is required")
  .refine(value => !(value.extendHours && value.expiresAt), "Use either expiresAt or extendHours, not both");
const revokeManualPlanSchema = z.object({ reason, version: z.number().int().min(1), idempotencyKey }).strict();

function validManualPlanTimes(startsAt: Date, expiresAt: Date, now = new Date()) {
  if (expiresAt.getTime() <= startsAt.getTime()) return "Manual plan expiry must be after its start";
  if (startsAt.getTime() > now.getTime() + 366 * 24 * 3600_000) return "Manual plan start may be at most 366 days ahead";
  if (expiresAt.getTime() > now.getTime() + 5 * 366 * 24 * 3600_000) return "Manual plan expiry may be at most five years ahead";
  return null;
}

// This ordering matches ensureNoCardTrial: the shared trial key is obtained
// first, then the same user row is locked. A manual grant that wins the race
// therefore makes a new no-card trial ineligible; a later manual grant keeps
// an already-legitimate trial ledger intact.
async function lockManualPlanMutation(tx: any, userId: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"no-card-trial:" + userId}))`);
  await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"manual-plan:" + userId}))`);
}

async function recordAudit(data: {
  actorUserId: string; targetUserId?: string | null; action: string; reason: string;
  before?: Record<string, unknown> | null; after?: Record<string, unknown> | null; requestId?: string | null;
}) {
  await db.insert(adminAuditEvents).values({
    actorUserId: data.actorUserId, targetUserId: data.targetUserId || null, action: data.action, reason: data.reason,
    before: data.before || null, after: data.after || null, requestId: data.requestId || null,
  });
}
function requirePermission(permission?: ManagementPermission): RequestHandler {
  return async (req: SessionRequest, res, next) => {
    try {
      if (!req.session?.userId) return res.status(401).json({ message: "Unauthorized" });
      const user = await storage.getUser(req.session.userId);
      if (!user || !user.isActive) return res.status(403).json({ message: "Account is suspended or unavailable" });
      const [metadata] = await db.select({ managementRole: memberAdminMetadata.managementRole }).from(memberAdminMetadata)
        .where(eq(memberAdminMetadata.userId, user.id)).limit(1);
      const actor = actorFor(user, metadata?.managementRole);
      if (actor.role === "member" || (permission && !can(actor, permission))) return res.status(403).json({ message: "Forbidden" });
      (req as any).managementActor = actor;
      next();
    } catch (error) {
      next(error);
    }
  };
}
function actor(req: Request) { return (req as any).managementActor as Actor; }
async function targetOr404(id: string) {
  return storage.getUser(id);
}
async function assignedRole(userId: string): Promise<ManagementRole> {
  const [metadata] = await db.select({ managementRole: memberAdminMetadata.managementRole }).from(memberAdminMetadata)
    .where(eq(memberAdminMetadata.userId, userId)).limit(1);
  return metadata?.managementRole || "member";
}
async function guardTarget(actorValue: Actor, target: typeof users.$inferSelect, changingRole = false, identitySensitive = false) {
  if (target.isSuperAdmin && !actorValue.isRoot) throw Object.assign(new Error("Protected root account"), { status: 403 });
  if (target.id === actorValue.id && changingRole) throw Object.assign(new Error("You cannot change your own role"), { status: 403 });
  if (identitySensitive && !actorValue.isRoot && await assignedRole(target.id) !== "member") {
    throw Object.assign(new Error("Only a protected root may change another management account's identity or reset its password"), { status: 403 });
  }
}
export async function ensureNotLastAdmin(tx: any, target: typeof users.$inferSelect, targetRole: ManagementRole, removingAdmin: boolean) {
  if (!removingAdmin || roleFor(target, targetRole) !== "super_admin") return;
  const [row] = await tx.select({ value: count() }).from(users).leftJoin(memberAdminMetadata, eq(memberAdminMetadata.userId, users.id))
    .where(and(eq(users.isActive, true), or(eq(users.isSuperAdmin, true), eq(memberAdminMetadata.managementRole, "super_admin"))));
  if (Number(row?.value || 0) <= 1) throw Object.assign(new Error("The final super-admin cannot be removed or disabled"), { status: 403 });
}
function csv(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, "\"\"")}"`;
}
async function liveSubscription(user: typeof users.$inferSelect, stripe: any) {
  if (!user.stripeSubscriptionId && !user.stripeCustomerId) return { item: null, error: null };
  try {
    const item = user.stripeSubscriptionId
      ? await stripe.subscriptions.retrieve(user.stripeSubscriptionId, { expand: ["items.data.price", "latest_invoice"] })
      : (await stripe.subscriptions.list({ customer: user.stripeCustomerId!, status: "all", limit: 1, expand: ["data.items.data.price", "data.latest_invoice"] })).data[0] || null;
    if (item) {
      const customer = typeof item.customer === "string" ? item.customer : item.customer?.id;
      if (!user.stripeCustomerId || !customer || customer !== user.stripeCustomerId) {
        return { item: null, error: "Stripe subscription customer does not match this member" };
      }
    }
    return { item, error: null };
  } catch { return { item: null, error: "Stripe subscription lookup failed for this connected account" }; }
}
function subscriptionDto(user: typeof users.$inferSelect, item: any, environment: "connected" | "unavailable" | "error", receiptUrl: string | null = null) {
  const price = item?.items?.data?.find((line: any) => Boolean(line.price?.recurring))?.price;
  const interval = price?.recurring?.interval === "year" ? "year" : price?.recurring?.interval === "month" ? "month"
    : user.subscriptionStatus === "trialing" ? "trial" : user.subscriptionPlan === "legacy" ? "legacy" : null;
  return {
    userId: user.id, username: user.username, email: user.email, plan: user.subscriptionPlan, status: item?.status || user.subscriptionStatus,
    interval, amountMinor: typeof price?.unit_amount === "number" ? price.unit_amount : null,
    currency: typeof price?.currency === "string" ? price.currency.toUpperCase() : null,
    currentPeriodEnd: item?.current_period_end ? new Date(item.current_period_end * 1000).toISOString() : iso(user.planExpiresAt),
    cancelAtPeriodEnd: item?.cancel_at_period_end ?? user.cancelAtPeriodEnd,
    provider: (user.stripeSubscriptionId || user.stripeCustomerId) ? "stripe" : "none",
    providerSubscriptionPresent: Boolean(item), providerEnvironment: environment, receiptUrl,
  };
}

export function registerAdminManagementRoutes(app: Express, revokeSessions: RevokeSessions, dependencies: { getStripe?: typeof getUncachableStripeClient } = {}) {
  const getStripe = dependencies.getStripe || getUncachableStripeClient;
  app.get("/api/management/me", requirePermission(), async (req, res) => {
    const value = actor(req);
    const user = await storage.getUser(value.id);
    if (!user) return res.status(401).json({ message: "Unauthorized" });
    res.json({ id: user.id, username: user.username, managementRole: value.role, canManage: true,
      permissions: Array.from(value.permissions), isRoot: value.isRoot });
  });

  app.get("/api/management/catalog", requirePermission(), (_req, res) => {
    res.json({ plans: Object.entries(SUBSCRIPTION_PLANS).map(([key, plan]) => ({
      key, label: plan.label, monthlyAmountMinor: plan.amountUsd * 100, annualAmountMinor: plan.annualAmountUsd * 100,
      currency: "USD" as const, baseWebinars: plan.baseWebinars, monthlyAiPoints: plan.monthlyAiPoints,
    })), roles: managementRoles.map(role => ({ role, permissions: MANAGEMENT_ROLE_PERMISSIONS[role] })) });
  });

  app.get("/api/management/overview", requirePermission("members.read"), async (_req, res) => {
    const [[usersTotal], [active], [disabled], [paid], [open]] = await Promise.all([
      db.select({ value: count() }).from(users),
      db.select({ value: count() }).from(users).where(eq(users.isActive, true)),
      db.select({ value: count() }).from(users).where(eq(users.isActive, false)),
      db.select({ value: count() }).from(users).where(eq(users.subscriptionStatus, "active")),
      db.select({ value: count() }).from(supportFeedback).where(or(eq(supportFeedback.status, "open"), eq(supportFeedback.status, "in_progress"))),
    ]);
    const expired = await db.select({ value: count() }).from(users).where(and(eq(users.isActive, true), lte(users.planExpiresAt, new Date())));
    res.json({ totals: { users: Number(usersTotal?.value || 0), activeUsers: Number(active?.value || 0),
      disabledUsers: Number(disabled?.value || 0), paidSubscriptions: Number(paid?.value || 0), openSupportCases: Number(open?.value || 0) },
    warnings: Number(expired[0]?.value || 0) ? [{ code: "expired_subscription", count: Number(expired[0]?.value), message: "Active accounts with an expired recorded subscription" }] : [] });
  });

  app.get("/api/management/members", requirePermission("members.read"), async (req, res) => {
    const parsed = memberListQuerySchema.safeParse(req.query);
    if (!issue(res, parsed)) return;
    const q = parsed.data;
    const terms = [];
    if (q.search) terms.push(or(ilike(users.username, likePattern(q.search)), ilike(users.email, likePattern(q.search)), ilike(users.companyName, likePattern(q.search)))!);
    if (q.active !== undefined) terms.push(eq(users.isActive, q.active));
    if (q.plan) terms.push(eq(users.subscriptionPlan, q.plan));
    if (q.role) terms.push(q.role === "super_admin" ? or(eq(users.isSuperAdmin, true), eq(memberAdminMetadata.managementRole, "super_admin"))! : eq(sql`coalesce(${memberAdminMetadata.managementRole}, 'member')`, q.role));
    const where = terms.length ? and(...terms) : undefined;
    const [[total], rows] = await Promise.all([
      db.select({ value: count() }).from(users).leftJoin(memberAdminMetadata, eq(memberAdminMetadata.userId, users.id)).where(where),
      db.select({ user: users, managementRole: memberAdminMetadata.managementRole, webinarCount: sql<number>`(select count(*)::int from ${webinars} where ${webinars.userId} = ${users.id})` })
        .from(users).leftJoin(memberAdminMetadata, eq(memberAdminMetadata.userId, users.id)).where(where).orderBy(desc(users.createdAt), asc(users.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    ]);
    const current = actor(req);
    res.json({ items: rows.map(row => memberDto(row.user, Number(row.webinarCount || 0), [], [], can(current, "subscriptions.read"), can(current, "credits.read"), row.managementRole || "member")), total: Number(total?.value || 0), page: q.page, pageSize: q.pageSize });
  });

  app.get("/api/management/members/:userId", requirePermission("members.read"), async (req, res) => {
    const id = uuid.safeParse(req.params.userId); if (!issue(res, id)) return;
    const user = await targetOr404(id.data); if (!user) return res.status(404).json({ message: "Member not found" });
    const [metadata, webinarRows] = await Promise.all([
      db.select().from(memberAdminMetadata).where(eq(memberAdminMetadata.userId, user.id)).limit(1),
      db.select({ id: webinars.id, title: webinars.title, publishStatus: webinars.publishStatus, createdAt: webinars.createdAt }).from(webinars).where(eq(webinars.userId, user.id)).orderBy(desc(webinars.createdAt)).limit(100),
    ]);
    const current = actor(req);
    const response: any = { profile: memberDto(user, webinarRows.length, metadata[0]?.notes || [], metadata[0]?.tags || [], can(current, "subscriptions.read"), can(current, "credits.read"), metadata[0]?.managementRole || "member"), webinars: webinarRows.map(row => ({ ...row, createdAt: iso(row.createdAt) })) };
    if (can(current, "subscriptions.read")) {
      const override = await activePublishingOverride(user.id);
      response.override = override ? overrideDto(override) : null;
      const manual = await memberManualPlan(user.id);
      response.manualPlan = manual ? manualPlanDto(manual) : null;
      response.effectivePlan = composePublishingOverride(effectiveMemberPlan(storedPaidEntitlement(user), manual), override);
      // Trial history is billing-sensitive account information: expose it only
      // to roles already allowed to read subscription data.
      response.noCardTrial = await getNoCardTrialStatus(user.id);
      try {
        const stripe = await getStripe(); const remote = await liveSubscription(user, stripe);
        response.subscription = subscriptionDto(user, remote.item, remote.error ? "error" : "connected", remote.item?.latest_invoice?.hosted_invoice_url || null);
      } catch { response.subscription = subscriptionDto(user, null, "unavailable"); }
    }
    if (can(current, "credits.read")) {
      const lots = await db.select().from(aiCreditLots).where(eq(aiCreditLots.userId, user.id)).orderBy(desc(aiCreditLots.grantedAt)).limit(100);
      const published = webinarRows.filter(row => row.publishStatus === "published").length;
      const [registrationTotal] = await db.select({ value: count() }).from(registrations).innerJoin(webinars, eq(registrations.webinarId, webinars.id)).where(eq(webinars.userId, user.id));
      response.usage = { webinars: webinarRows.length, publishedWebinars: published, registrations: Number(registrationTotal?.value || 0), aiPoints: user.aiPoints, aiLots: lots.map(lot => ({ ...lot, grantedAt: lot.grantedAt.toISOString(), expiresAt: iso(lot.expiresAt) })) };
    }
    if (can(current, "billing.read")) {
      const offers = await db.select({ id: webinarOffers.id, name: webinarOffers.ecpayItemName, active: webinarOffers.active, createdAt: webinarOffers.createdAt }).from(webinarOffers).where(eq(webinarOffers.userId, user.id)).limit(100);
      response.products = offers.map(row => ({ id: row.id, name: row.name || "Stripe product", status: row.active ? "active" : "inactive", createdAt: iso(row.createdAt) }));
    }
    res.json(response);
  });

  app.get("/api/management/members/:userId/ai-ledger", requirePermission("credits.read"), async (req, res) => {
    const id = uuid.safeParse(req.params.userId); if (!issue(res, id)) return;
    const page = pageSchema.pick({ page: true, pageSize: true }).safeParse(req.query); if (!issue(res, page)) return;
    const [[total], rows] = await Promise.all([
      db.select({ value: count() }).from(aiPointTransactions).where(eq(aiPointTransactions.userId, id.data)),
      db.select().from(aiPointTransactions).where(eq(aiPointTransactions.userId, id.data)).orderBy(desc(aiPointTransactions.createdAt), asc(aiPointTransactions.id)).limit(page.data.pageSize).offset((page.data.page - 1) * page.data.pageSize),
    ]);
    res.json({ total: Number(total?.value || 0), page: page.data.page, pageSize: page.data.pageSize, items: rows.map(row => ({
      id: row.id, type: row.type, points: row.points, amountMinor: row.amountTwd === null ? null : row.amountTwd * 100, currency: row.amountTwd === null ? null : "TWD", createdAt: iso(row.createdAt)!, source: row.stripeSessionId ? "stripe" : row.type,
    })) });
  });

  app.patch("/api/management/members/:userId/profile", requirePermission("members.write"), async (req, res) => {
    const id = uuid.safeParse(req.params.userId); if (!issue(res, id)) return;
    const body = z.object({ username: z.string().trim().min(3).max(100).optional(), email: z.string().trim().email().max(320).optional(), companyName: z.string().trim().max(200).optional(), reason }).strict().refine(v => v.username !== undefined || v.email !== undefined || v.companyName !== undefined, "At least one profile field is required").safeParse(req.body);
    if (!issue(res, body)) return;
    const user = await targetOr404(id.data); if (!user) return res.status(404).json({ message: "Member not found" });
    try {
      await guardTarget(actor(req), user, false, body.data.username !== undefined || body.data.email !== undefined);
      const updated = await db.transaction(async tx => {
        const result = await tx.update(users).set({ username: body.data.username, email: body.data.email, companyName: body.data.companyName }).where(eq(users.id, user.id)).returning();
        await tx.insert(adminAuditEvents).values({ actorUserId: actor(req).id, targetUserId: user.id, action: "member.profile.update", reason: body.data.reason, before: { username: user.username, email: user.email, companyName: user.companyName }, after: { username: result[0].username, email: result[0].email, companyName: result[0].companyName } });
        return result[0];
      });
      res.json(memberDto(updated));
    } catch (error: any) { res.status(error.status || 400).json({ message: error.message || "Unable to update profile" }); }
  });

  app.patch("/api/management/members/:userId/role", requirePermission("members.roles"), async (req, res) => {
    const id = uuid.safeParse(req.params.userId); if (!issue(res, id)) return;
    const body = z.object({ role: z.enum(managementRoles), reason }).strict().safeParse(req.body); if (!issue(res, body)) return;
    const user = await targetOr404(id.data); if (!user) return res.status(404).json({ message: "Member not found" });
    try {
      const current = actor(req);
      if (body.data.role === "super_admin" && !current.isRoot) throw Object.assign(new Error("Only a protected root may appoint a super-admin"), { status: 403 });
      await db.transaction(async tx => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('management-super-admin'))`);
        const [targetMetadata] = await tx.select({ managementRole: memberAdminMetadata.managementRole }).from(memberAdminMetadata).where(eq(memberAdminMetadata.userId, user.id)).for("update");
        const targetRole = targetMetadata?.managementRole || "member";
        await guardTarget(current, user, true);
        if (roleFor(user, targetRole) === "super_admin" && body.data.role !== "super_admin") await ensureNotLastAdmin(tx, user, targetRole, true);
        await tx.insert(memberAdminMetadata).values({ userId: user.id, managementRole: body.data.role, notes: [], tags: [] }).onConflictDoUpdate({ target: memberAdminMetadata.userId, set: { managementRole: body.data.role, updatedAt: new Date() } });
        await tx.insert(adminAuditEvents).values({ actorUserId: current.id, targetUserId: user.id, action: "member.role.update", reason: body.data.reason, before: { role: roleFor(user, targetRole) }, after: { role: body.data.role } });
      });
      const updated = await storage.getUser(user.id); res.json(memberDto(updated!, 0, [], [], false, false, body.data.role));
    } catch (error: any) { res.status(error.status || 400).json({ message: error.message || "Unable to update role" }); }
  });

  for (const operation of ["disable", "enable"] as const) {
    app.post(`/api/management/members/:userId/${operation}`, requirePermission("members.disable"), async (req, res) => {
      const id = uuid.safeParse(req.params.userId); if (!issue(res, id)) return;
      const body = z.object({ reason }).strict().safeParse(req.body); if (!issue(res, body)) return;
      const user = await targetOr404(id.data); if (!user) return res.status(404).json({ message: "Member not found" });
      try {
        const current = actor(req);
        if (operation === "disable" && user.id === current.id) throw Object.assign(new Error("You cannot disable your own account"), { status: 403 });
        await db.transaction(async tx => {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('management-super-admin'))`);
          const [targetMetadata] = await tx.select({ managementRole: memberAdminMetadata.managementRole }).from(memberAdminMetadata).where(eq(memberAdminMetadata.userId, user.id)).for("update");
          await guardTarget(current, user);
          if (operation === "disable") await ensureNotLastAdmin(tx, user, targetMetadata?.managementRole || "member", true);
          await tx.update(users).set({ isActive: operation === "enable" }).where(eq(users.id, user.id));
          await tx.insert(adminAuditEvents).values({ actorUserId: current.id, targetUserId: user.id, action: `member.${operation}`, reason: body.data.reason, before: { isActive: user.isActive }, after: { isActive: operation === "enable" } });
        });
        if (operation === "disable") await revokeSessions(user.id);
        const updated = await storage.getUser(user.id); res.json(memberDto(updated!));
      } catch (error: any) { res.status(error.status || 400).json({ message: error.message || `Unable to ${operation} member` }); }
    });
  }

  app.post("/api/management/members/:userId/revoke-sessions", requirePermission("members.disable"), async (req, res) => {
    const id = uuid.safeParse(req.params.userId); if (!issue(res, id)) return;
    const body = z.object({ reason }).strict().safeParse(req.body); if (!issue(res, body)) return;
    const user = await targetOr404(id.data); if (!user) return res.status(404).json({ message: "Member not found" });
    try { await guardTarget(actor(req), user); await revokeSessions(user.id); await recordAudit({ actorUserId: actor(req).id, targetUserId: user.id, action: "member.sessions.revoke", reason: body.data.reason }); res.json({ revoked: true }); }
    catch (error: any) { res.status(error.status || 400).json({ message: error.message || "Unable to revoke sessions" }); }
  });

  app.post("/api/management/members/:userId/password-reset", requirePermission("members.write"), async (req, res) => {
    const id = uuid.safeParse(req.params.userId); if (!issue(res, id)) return;
    const body = z.object({ reason }).strict().safeParse(req.body); if (!issue(res, body)) return;
    const user = await targetOr404(id.data); if (!user) return res.status(404).json({ message: "Member not found" });
    try {
      await guardTarget(actor(req), user, false, true); if (!user.email) throw new Error("This account has no email address");
      const token = createRawToken();
      await storage.createAuthToken(user.id, "password_reset", hashToken(token), new Date(Date.now() + 15 * 60 * 1000));
      await sendTransactionalMail({ to: user.email, subject: "Reset your password", html: `<p><a href="${appBaseUrl()}/reset-password?token=${encodeURIComponent(token)}">Reset password</a>. This link expires in 15 minutes.</p>` });
      await recordAudit({ actorUserId: actor(req).id, targetUserId: user.id, action: "member.password_reset.request", reason: body.data.reason });
      res.json({ requested: true });
    } catch (error: any) { res.status(error.status || 409).json({ message: error.message || "Password reset could not be requested" }); }
  });

  app.put("/api/management/members/:userId/notes", requirePermission("members.write"), async (req, res) => {
    const id = uuid.safeParse(req.params.userId); if (!issue(res, id)) return;
    const body = z.object({ notes: z.array(z.string().trim().min(1).max(2000)).max(50), tags: z.array(z.string().trim().min(1).max(80)).max(50), reason }).strict().safeParse(req.body); if (!issue(res, body)) return;
    const user = await targetOr404(id.data); if (!user) return res.status(404).json({ message: "Member not found" });
    try { await guardTarget(actor(req), user); await db.transaction(async tx => { await tx.insert(memberAdminMetadata).values({ userId: user.id, notes: body.data.notes, tags: body.data.tags, updatedAt: new Date() }).onConflictDoUpdate({ target: memberAdminMetadata.userId, set: { notes: body.data.notes, tags: body.data.tags, updatedAt: new Date() } }); await tx.insert(adminAuditEvents).values({ actorUserId: actor(req).id, targetUserId: user.id, action: "member.notes.update", reason: body.data.reason, after: { notes: body.data.notes, tags: body.data.tags } }); }); res.json(memberDto(user, 0, body.data.notes, body.data.tags)); }
    catch (error: any) { res.status(error.status || 400).json({ message: error.message || "Unable to save notes" }); }
  });

  app.post("/api/management/members/:userId/overrides", requirePermission("subscriptions.write"), async (req, res) => {
    const id = uuid.safeParse(req.params.userId); if (!issue(res, id)) return;
    const body = z.object({ publishingSlots: z.number().int().min(1).max(999), expiresAt: z.coerce.date(), reason }).strict().safeParse(req.body); if (!issue(res, body)) return;
    if (body.data.expiresAt.getTime() < Date.now() + 60_000 || body.data.expiresAt.getTime() > Date.now() + 366 * 24 * 3600_000) return res.status(400).json({ message: "Override expiry must be between one minute and 366 days" });
    const user = await targetOr404(id.data); if (!user) return res.status(404).json({ message: "Member not found" });
    try { await guardTarget(actor(req), user); const [row] = await db.transaction(async tx => { const inserted = await tx.insert(entitlementOverrides).values({ userId: user.id, publishingSlots: body.data.publishingSlots, expiresAt: body.data.expiresAt, reason: body.data.reason, createdBy: actor(req).id }).returning(); await tx.insert(adminAuditEvents).values({ actorUserId: actor(req).id, targetUserId: user.id, action: "entitlement_override.create", reason: body.data.reason, after: { publishingSlots: body.data.publishingSlots, expiresAt: body.data.expiresAt.toISOString() } }); return inserted; }); res.status(201).json(overrideDto(row)); }
    catch (error: any) { res.status(error.status || 400).json({ message: error.message || "Unable to create override" }); }
  });

  app.delete("/api/management/members/:userId/overrides/:overrideId", requirePermission("subscriptions.write"), async (req, res) => {
    const userId = uuid.safeParse(req.params.userId), overrideId = uuid.safeParse(req.params.overrideId); if (!issue(res, userId) || !issue(res, overrideId)) return;
    const body = z.object({ reason }).strict().safeParse(req.body); if (!issue(res, body)) return;
    const user = await targetOr404(userId.data); if (!user) return res.status(404).json({ message: "Member not found" });
    try { await guardTarget(actor(req), user); const removed = await db.delete(entitlementOverrides).where(and(eq(entitlementOverrides.id, overrideId.data), eq(entitlementOverrides.userId, user.id), isNull(entitlementOverrides.manualPlan))).returning({ id: entitlementOverrides.id }); if (!removed[0]) return res.status(404).json({ message: "Override not found" }); await recordAudit({ actorUserId: actor(req).id, targetUserId: user.id, action: "entitlement_override.delete", reason: body.data.reason, before: { id: overrideId.data } }); res.json({ removed: true }); }
    catch (error: any) { res.status(error.status || 400).json({ message: error.message || "Unable to remove override" }); }
  });

  app.post("/api/management/members/:userId/manual-plan", requirePermission("subscriptions.write"), async (req, res) => {
    const id = uuid.safeParse(req.params.userId); if (!issue(res, id)) return;
    const body = createManualPlanSchema.safeParse(req.body); if (!issue(res, body)) return;
    const timeIssue = validManualPlanTimes(body.data.startsAt, body.data.expiresAt); if (timeIssue) return res.status(400).json({ message: timeIssue });
    const user = await targetOr404(id.data); if (!user) return res.status(404).json({ message: "Member not found" });
    try {
      await guardTarget(actor(req), user);
      const result = await db.transaction(async tx => {
        await lockManualPlanMutation(tx, user.id);
        const mutationKey = `manual-plan:create:${user.id}:${body.data.idempotencyKey}`;
        const fingerprint = idempotencyFingerprint(body.data);
        const [prior] = await tx.select().from(adminMutationIdempotency)
          .where(eq(adminMutationIdempotency.idempotencyKey, mutationKey)).for("update");
        if (prior) {
          if (prior.payloadFingerprint !== fingerprint) throw Object.assign(new Error("Idempotency key was already used with a different manual-plan payload"), { status: 409 });
          const [existing] = await tx.select().from(entitlementOverrides).where(and(eq(entitlementOverrides.userId, user.id), isNotNull(entitlementOverrides.manualPlan))).for("update");
          if (!existing) throw Object.assign(new Error("Manual plan idempotency record has no retained grant"), { status: 409 });
          return { row: existing, created: false };
        }
        const [existing] = await tx.select().from(entitlementOverrides).where(and(eq(entitlementOverrides.userId, user.id), isNotNull(entitlementOverrides.manualPlan))).for("update");
        if (existing && !existing.revokedAt) throw Object.assign(new Error("A manual plan already exists; update or revoke it instead"), { status: 409 });
        const slots = SUBSCRIPTION_PLANS[body.data.plan].baseWebinars;
        const [row] = existing
          ? await tx.update(entitlementOverrides).set({
            manualPlan: body.data.plan, publishingSlots: slots, startsAt: body.data.startsAt, expiresAt: body.data.expiresAt,
            reason: body.data.reason, createdBy: actor(req).id, revokedAt: null, revokedBy: null,
            version: existing.version + 1, updatedAt: new Date(),
          }).where(eq(entitlementOverrides.id, existing.id)).returning()
          : await tx.insert(entitlementOverrides).values({
            userId: user.id, manualPlan: body.data.plan, publishingSlots: slots, startsAt: body.data.startsAt,
            expiresAt: body.data.expiresAt, reason: body.data.reason, createdBy: actor(req).id,
          }).returning();
        await tx.insert(adminMutationIdempotency).values({
          idempotencyKey: mutationKey, actorUserId: actor(req).id, action: "manual_plan.create",
          targetUserId: user.id, payloadFingerprint: fingerprint, status: "completed",
        });
        await tx.insert(adminAuditEvents).values({
          actorUserId: actor(req).id, targetUserId: user.id, action: "manual_plan.create", reason: body.data.reason,
          before: existing ? { id: existing.id, state: "revoked", version: existing.version } : null,
          after: { id: row.id, plan: row.manualPlan, startsAt: row.startsAt.toISOString(), expiresAt: row.expiresAt.toISOString(), version: row.version },
        });
        return { row, created: true };
      });
      res.status(result.created ? 201 : 200).json(manualPlanDto(result.row));
    } catch (error: any) { res.status(error.status || 400).json({ message: error.message || "Unable to create manual plan" }); }
  });

  app.patch("/api/management/members/:userId/manual-plan", requirePermission("subscriptions.write"), async (req, res) => {
    const id = uuid.safeParse(req.params.userId); if (!issue(res, id)) return;
    const body = updateManualPlanSchema.safeParse(req.body); if (!issue(res, body)) return;
    const user = await targetOr404(id.data); if (!user) return res.status(404).json({ message: "Member not found" });
    try {
      await guardTarget(actor(req), user);
      const result = await db.transaction(async tx => {
        await lockManualPlanMutation(tx, user.id);
        const mutationKey = `manual-plan:update:${user.id}:${body.data.idempotencyKey}`;
        const fingerprint = idempotencyFingerprint(body.data);
        const [prior] = await tx.select().from(adminMutationIdempotency).where(eq(adminMutationIdempotency.idempotencyKey, mutationKey)).for("update");
        const [existing] = await tx.select().from(entitlementOverrides).where(and(eq(entitlementOverrides.userId, user.id), isNotNull(entitlementOverrides.manualPlan))).for("update");
        if (prior) {
          if (prior.payloadFingerprint !== fingerprint) throw Object.assign(new Error("Idempotency key was already used with a different manual-plan payload"), { status: 409 });
          if (!existing) throw Object.assign(new Error("Manual plan idempotency record has no retained grant"), { status: 409 });
          return { row: existing, changed: false };
        }
        if (!existing) throw Object.assign(new Error("Manual plan not found"), { status: 404 });
        if (existing.revokedAt) throw Object.assign(new Error("A revoked manual plan must be granted again, not updated"), { status: 409 });
        if (existing.version !== body.data.version) throw Object.assign(new Error("Manual plan was changed by another administrator; reload and try again"), { status: 409 });
        const startsAt = body.data.startsAt || existing.startsAt;
        const expiresAt = body.data.extendHours
          ? new Date(Math.max(Date.now(), existing.expiresAt.getTime()) + body.data.extendHours * 3600_000)
          : body.data.expiresAt || existing.expiresAt;
        const timeIssue = validManualPlanTimes(startsAt, expiresAt); if (timeIssue) throw Object.assign(new Error(timeIssue), { status: 400 });
        const plan = body.data.plan || existing.manualPlan as MemberManualPlanKey;
        const [row] = await tx.update(entitlementOverrides).set({
          manualPlan: plan, publishingSlots: SUBSCRIPTION_PLANS[plan].baseWebinars, startsAt, expiresAt,
          reason: body.data.reason, version: existing.version + 1, updatedAt: new Date(),
        }).where(and(eq(entitlementOverrides.id, existing.id), eq(entitlementOverrides.version, body.data.version))).returning();
        if (!row) throw Object.assign(new Error("Manual plan was changed by another administrator; reload and try again"), { status: 409 });
        await tx.insert(adminMutationIdempotency).values({
          idempotencyKey: mutationKey, actorUserId: actor(req).id, action: body.data.extendHours ? "manual_plan.extend" : "manual_plan.update",
          targetUserId: user.id, payloadFingerprint: fingerprint, status: "completed",
        });
        await tx.insert(adminAuditEvents).values({
          actorUserId: actor(req).id, targetUserId: user.id, action: body.data.extendHours ? "manual_plan.extend" : "manual_plan.update", reason: body.data.reason,
          before: { plan: existing.manualPlan, startsAt: existing.startsAt.toISOString(), expiresAt: existing.expiresAt.toISOString(), version: existing.version },
          after: { plan: row.manualPlan, startsAt: row.startsAt.toISOString(), expiresAt: row.expiresAt.toISOString(), version: row.version },
        });
        return { row, changed: true };
      });
      res.json(manualPlanDto(result.row));
    } catch (error: any) { res.status(error.status || 400).json({ message: error.message || "Unable to update manual plan" }); }
  });

  app.delete("/api/management/members/:userId/manual-plan", requirePermission("subscriptions.write"), async (req, res) => {
    const id = uuid.safeParse(req.params.userId); if (!issue(res, id)) return;
    const body = revokeManualPlanSchema.safeParse(req.body); if (!issue(res, body)) return;
    const user = await targetOr404(id.data); if (!user) return res.status(404).json({ message: "Member not found" });
    try {
      await guardTarget(actor(req), user);
      const result = await db.transaction(async tx => {
        await lockManualPlanMutation(tx, user.id);
        const mutationKey = `manual-plan:revoke:${user.id}:${body.data.idempotencyKey}`;
        const fingerprint = idempotencyFingerprint(body.data);
        const [prior] = await tx.select().from(adminMutationIdempotency).where(eq(adminMutationIdempotency.idempotencyKey, mutationKey)).for("update");
        const [existing] = await tx.select().from(entitlementOverrides).where(and(eq(entitlementOverrides.userId, user.id), isNotNull(entitlementOverrides.manualPlan))).for("update");
        if (prior) {
          if (prior.payloadFingerprint !== fingerprint) throw Object.assign(new Error("Idempotency key was already used with a different manual-plan payload"), { status: 409 });
          if (!existing) throw Object.assign(new Error("Manual plan idempotency record has no retained grant"), { status: 409 });
          return { row: existing };
        }
        if (!existing) throw Object.assign(new Error("Manual plan not found"), { status: 404 });
        if (existing.revokedAt) throw Object.assign(new Error("Manual plan is already revoked"), { status: 409 });
        if (existing.version !== body.data.version) throw Object.assign(new Error("Manual plan was changed by another administrator; reload and try again"), { status: 409 });
        const [row] = await tx.update(entitlementOverrides).set({
          revokedAt: new Date(), revokedBy: actor(req).id, version: existing.version + 1, updatedAt: new Date(),
        }).where(and(eq(entitlementOverrides.id, existing.id), eq(entitlementOverrides.version, body.data.version))).returning();
        if (!row) throw Object.assign(new Error("Manual plan was changed by another administrator; reload and try again"), { status: 409 });
        await tx.insert(adminMutationIdempotency).values({
          idempotencyKey: mutationKey, actorUserId: actor(req).id, action: "manual_plan.revoke",
          targetUserId: user.id, payloadFingerprint: fingerprint, status: "completed",
        });
        await tx.insert(adminAuditEvents).values({
          actorUserId: actor(req).id, targetUserId: user.id, action: "manual_plan.revoke", reason: body.data.reason,
          before: { plan: existing.manualPlan, startsAt: existing.startsAt.toISOString(), expiresAt: existing.expiresAt.toISOString(), version: existing.version },
          after: { id: row.id, revokedAt: row.revokedAt?.toISOString() || null, version: row.version },
        });
        return { row };
      });
      res.json(manualPlanDto(result.row));
    } catch (error: any) { res.status(error.status || 400).json({ message: error.message || "Unable to revoke manual plan" }); }
  });

  app.post("/api/management/members/:userId/ai-grants", requirePermission("credits.grant"), async (req, res) => {
    const id = uuid.safeParse(req.params.userId); if (!issue(res, id)) return;
    const body = z.object({ points: z.number().int().min(1).max(100_000), expiresAt: z.coerce.date().optional(), reason, idempotencyKey: z.string().trim().min(8).max(100).regex(/^[A-Za-z0-9_.:-]+$/) }).strict().safeParse(req.body); if (!issue(res, body)) return;
    if (body.data.expiresAt && body.data.expiresAt <= new Date()) return res.status(400).json({ message: "Credit expiry must be in the future" });
    const user = await targetOr404(id.data); if (!user) return res.status(404).json({ message: "Member not found" });
    try { await guardTarget(actor(req), user); const result = await storage.grantAiCredits({ userId: user.id, points: body.data.points, source: "admin_grant", expiresAt: body.data.expiresAt || null, idempotencyKey: `admin-grant:${user.id}:${body.data.idempotencyKey}` }); if (result.added) await recordAudit({ actorUserId: actor(req).id, targetUserId: user.id, action: "ai_credit.grant", reason: body.data.reason, after: { points: body.data.points, expiresAt: iso(body.data.expiresAt), idempotencyKey: body.data.idempotencyKey } }); res.json(result); }
    catch (error: any) { res.status(error.status || 400).json({ message: error.message || "Unable to grant credits" }); }
  });

  app.get("/api/management/subscriptions", requirePermission("subscriptions.read"), async (req, res) => {
    const parsed = pageSchema.extend({ status: z.string().trim().max(60).optional() }).safeParse(req.query); if (!issue(res, parsed)) return;
    const q = parsed.data, terms = [];
    if (q.userId) terms.push(eq(users.id, q.userId)); if (q.status) terms.push(eq(users.subscriptionStatus, q.status));
    if (q.search) terms.push(or(ilike(users.username, likePattern(q.search)), ilike(users.email, likePattern(q.search)))!);
    const where = terms.length ? and(...terms) : undefined;
    const [[total], rows] = await Promise.all([db.select({ value: count() }).from(users).where(where), db.select().from(users).where(where).orderBy(desc(users.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize)]);
    try {
      const stripe = await getStripe();
      const items = await Promise.all(rows.map(async user => { const remote = await liveSubscription(user, stripe); return subscriptionDto(user, remote.item, remote.error ? "error" : "connected", remote.item?.latest_invoice?.hosted_invoice_url || null); }));
      res.json({ items, total: Number(total?.value || 0), page: q.page, pageSize: q.pageSize, availability: [{ provider: "stripe", available: true, source: "live", message: null }] });
    } catch { res.json({ items: rows.map(user => subscriptionDto(user, null, "unavailable")), total: Number(total?.value || 0), page: q.page, pageSize: q.pageSize, availability: [{ provider: "stripe", available: false, source: "local", message: "Stripe provider is unavailable or connected to a different account" }] }); }
  });

  for (const action of ["cancel-at-period-end", "resume"] as const) {
    app.post(`/api/management/subscriptions/:userId/${action}`, requirePermission("subscriptions.write"), async (req, res) => {
      const id = uuid.safeParse(req.params.userId); if (!issue(res, id)) return;
      const body = z.object({ reason }).strict().safeParse(req.body); if (!issue(res, body)) return;
      const user = await targetOr404(id.data); if (!user) return res.status(404).json({ message: "Member not found" });
      try {
        await guardTarget(actor(req), user); if (!user.stripeSubscriptionId) return res.status(409).json({ message: "No Stripe subscription is recorded for this member" });
        const stripe = await getStripe(); const remote = await stripe.subscriptions.retrieve(user.stripeSubscriptionId, { expand: ["items.data.price"] });
        const customer = typeof remote.customer === "string" ? remote.customer : remote.customer?.id;
        if (!customer || customer !== user.stripeCustomerId) return res.status(409).json({ message: "Stripe subscription ownership does not match this member" });
        const updated = await stripe.subscriptions.update(remote.id, { cancel_at_period_end: action === "cancel-at-period-end" });
        await db.update(users).set({ cancelAtPeriodEnd: updated.cancel_at_period_end }).where(eq(users.id, user.id));
        await recordAudit({ actorUserId: actor(req).id, targetUserId: user.id, action: `subscription.${action}`, reason: body.data.reason, before: { cancelAtPeriodEnd: remote.cancel_at_period_end }, after: { cancelAtPeriodEnd: updated.cancel_at_period_end } });
        res.json(subscriptionDto({ ...user, cancelAtPeriodEnd: updated.cancel_at_period_end }, updated, "connected"));
      } catch (error: any) { res.status(error.statusCode || error.status || 502).json({ message: error.message || "Stripe subscription update failed" }); }
    });
  }

  app.get("/api/management/orders", requirePermission("billing.read"), async (req, res) => {
    // One kind per request is deliberate: provider and local ledgers use
    // independent cursor models, so merging offset pages silently loses rows.
    // Clients default to the member-order tab; platform invoices and AI
    // purchases each receive their own complete server-side page.
    const parsed = pageSchema.extend({ provider: z.enum(["stripe", "ecpay"]).optional(), status: z.string().trim().max(60).optional(), kind: z.enum(["platform_invoice", "ai_purchase", "member_order"]).default("member_order"), from: z.coerce.date().optional(), to: z.coerce.date().optional() }).safeParse(req.query); if (!issue(res, parsed)) return;
    const q = parsed.data, terms = [];
    if (q.userId) terms.push(eq(webinarPayments.userId, q.userId)); if (q.provider) terms.push(eq(webinarPayments.paymentProvider, q.provider)); if (q.status) terms.push(eq(webinarPayments.status, q.status)); if (q.from) terms.push(gte(webinarPayments.createdAt, q.from)); if (q.to) terms.push(lte(webinarPayments.createdAt, q.to));
    const where = terms.length ? and(...terms) : undefined;
    const [[memberTotal], rows, aiRows] = await Promise.all([
      q.kind === "member_order" ? db.select({ value: count() }).from(webinarPayments).where(where) : Promise.resolve([] as any[]),
      q.kind === "member_order" ? db.select({ payment: webinarPayments, username: users.username }).from(webinarPayments).leftJoin(users, eq(webinarPayments.userId, users.id)).where(where).orderBy(desc(webinarPayments.createdAt), asc(webinarPayments.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize) : Promise.resolve([] as any[]),
      q.kind !== "ai_purchase" || (q.provider && q.provider !== "stripe") || (q.status && q.status !== "paid")
        ? Promise.resolve([])
        : db.select({ transaction: aiPointTransactions, username: users.username }).from(aiPointTransactions).innerJoin(users, eq(aiPointTransactions.userId, users.id)).where(and(
          eq(aiPointTransactions.type, "purchase"),
          ...(q.userId ? [eq(aiPointTransactions.userId, q.userId)] : []),
          ...(q.from ? [gte(aiPointTransactions.createdAt, q.from)] : []),
          ...(q.to ? [lte(aiPointTransactions.createdAt, q.to)] : []),
        )).orderBy(desc(aiPointTransactions.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    ]);
    let memberOrders: any[] = rows.map(row => ({ id: row.payment.id, kind: "member_order" as const, ownerUserId: row.payment.userId || "", ownerUsername: row.username || "Unresolved member", provider: row.payment.paymentProvider === "ecpay" ? "ecpay" as const : "stripe" as const, providerReference: row.payment.paymentProvider === "ecpay" ? row.payment.providerOrderId : row.payment.stripePaymentIntentId || row.payment.stripeCheckoutSessionId, status: row.payment.status, amountMinor: row.payment.amountMinor, refundedMinor: row.payment.refundedMinor, currency: row.payment.currency, createdAt: row.payment.createdAt.toISOString(), paidAt: iso(row.payment.purchasedAt), providerLookup: "local" as const, receiptUrl: null, providerEnvironment: row.payment.paymentProvider === "ecpay" ? "connected" as const : "unavailable" as const, providerMode: row.payment.paymentProvider === "ecpay" && (row.payment.providerEnvironment === "stage" || row.payment.providerEnvironment === "production") ? row.payment.providerEnvironment : "unknown", providerAccountLabel: row.payment.paymentProvider === "ecpay" ? "member-managed ECPay account" : "connected platform Stripe account" }));
    // Local member orders are ledger rows. When this app's Stripe connection
    // can prove the payment intent, enrich them with the provider's immutable
    // paid/refunded state and receipt URL; never write that state locally.
    let stripeMemberLookupError = false;
    const stripePaymentRows = rows.filter(row => row.payment.paymentProvider === "stripe" && row.payment.stripePaymentIntentId && row.payment.userId);
    if (stripePaymentRows.length) {
      try {
        const stripe = await getStripe();
        const enriched = await Promise.all(stripePaymentRows.map(async row => {
          try {
            const intent = await stripe.paymentIntents.retrieve(row.payment.stripePaymentIntentId!, { expand: ["latest_charge"] });
            if (intent.status !== "succeeded" || intent.metadata?.kind !== "webinar_offer" || intent.metadata?.paymentId !== row.payment.id || intent.metadata?.offerId !== row.payment.offerId || (row.payment.webinarId && intent.metadata?.webinarId !== row.payment.webinarId)) throw new Error("immutable order attribution mismatch");
            const charge: any = typeof intent.latest_charge === "string" ? await stripe.charges.retrieve(intent.latest_charge) : intent.latest_charge;
            return [row.payment.id, { status: intent.status, amountMinor: intent.amount, refundedMinor: Number(charge?.amount_refunded || 0), currency: intent.currency.toUpperCase(), receiptUrl: charge?.receipt_url || null }] as const;
          } catch {
            return [row.payment.id, null] as const;
          }
        }));
        const byId = new Map(enriched);
        memberOrders = memberOrders.map(order => !byId.has(order.id) ? order : byId.get(order.id)
          ? { ...order, ...byId.get(order.id), providerLookup: "live", providerEnvironment: "connected" }
          : { ...order, providerLookup: "error", providerEnvironment: "error" });
      } catch {
        stripeMemberLookupError = true;
        memberOrders = memberOrders.map(order => order.provider === "stripe" ? { ...order, providerLookup: "error", providerEnvironment: "error" } : order);
      }
    }
    const aiOrders = aiRows.map(row => ({ id: row.transaction.id, kind: "ai_purchase" as const, ownerUserId: row.transaction.userId, ownerUsername: row.username, provider: "stripe" as const, providerReference: row.transaction.stripeSessionId, status: "paid", amountMinor: (row.transaction.amountTwd || 0) * 100, refundedMinor: 0, currency: "TWD", createdAt: row.transaction.createdAt?.toISOString() || new Date(0).toISOString(), paidAt: row.transaction.createdAt?.toISOString() || null, providerLookup: "local" as const, receiptUrl: null, providerEnvironment: "connected" as const, providerMode: "connected" as const, providerAccountLabel: "connected platform Stripe account" }));
    let invoices: any[] = [], stripeError: string | null = null, stripeHasMore = false;
    if (q.kind === "platform_invoice" && (!q.provider || q.provider === "stripe")) {
      try {
        const stripe = await getStripe();
        const target = q.userId ? await targetOr404(q.userId) : undefined;
        if (q.userId && !target) return res.status(404).json({ message: "Member not found" });
        if (target && !target.stripeCustomerId) {
          stripeError = "This member has no Stripe customer in the connected account";
          throw new Error("member has no Stripe customer");
        }
        const invoiceArgs: any = {
          ...(target?.stripeCustomerId ? { customer: target.stripeCustomerId } : {}),
          ...(q.from || q.to ? { created: { ...(q.from ? { gte: Math.floor(q.from.getTime() / 1000) } : {}), ...(q.to ? { lte: Math.floor(q.to.getTime() / 1000) } : {}) } } : {}),
        };
        // Stripe is cursor based. Walk only the bounded offset requested by
        // this page; do not load the provider's full invoice history.
        let remaining = (q.page - 1) * q.pageSize, cursor: string | undefined;
        while (remaining > 0) {
          const prior = await stripe.invoices.list({ ...invoiceArgs, limit: Math.min(100, remaining), ...(cursor ? { starting_after: cursor } : {}) });
          if (!prior.data.length) break;
          remaining -= prior.data.length;
          cursor = prior.data[prior.data.length - 1].id;
          if (!prior.has_more) break;
        }
        const remote = await stripe.invoices.list({ ...invoiceArgs, limit: q.pageSize, ...(cursor ? { starting_after: cursor } : {}), expand: ["data.payment_intent.latest_charge"] });
        stripeHasMore = remote.has_more;
        const customerIds = Array.from(new Set(remote.data.map((invoice: any) => typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id).filter(Boolean)));
        const owners = customerIds.length ? await db.select({ id: users.id, username: users.username, stripeCustomerId: users.stripeCustomerId }).from(users).where(inArray(users.stripeCustomerId, customerIds)) : [];
        const byCustomer = new Map(owners.map(owner => [owner.stripeCustomerId, owner]));
        invoices = remote.data.filter((invoice: any) => !q.status || invoice.status === q.status).map((invoice: any) => {
          const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
          const owner = byCustomer.get(customerId);
          const intent: any = invoice.payment_intent;
          const charge: any = typeof intent?.latest_charge === "string" ? null : intent?.latest_charge;
          return { id: invoice.id, kind: "platform_invoice" as const, ownerUserId: owner?.id || "", ownerUsername: owner?.username || "Unmapped Stripe customer", provider: "stripe" as const, providerReference: invoice.number || invoice.id, status: invoice.status || "unknown", amountMinor: Number(invoice.amount_paid || 0), refundedMinor: Number(charge?.amount_refunded || 0), currency: String(invoice.currency || "").toUpperCase(), createdAt: new Date(Number(invoice.created || 0) * 1000).toISOString(), paidAt: invoice.status_transitions?.paid_at ? new Date(invoice.status_transitions.paid_at * 1000).toISOString() : null, providerLookup: "live" as const, receiptUrl: invoice.hosted_invoice_url || invoice.invoice_pdf || null, providerEnvironment: "connected" as const, providerMode: "connected" as const, providerAccountLabel: "connected platform Stripe account" };
        });
      } catch { stripeError ||= "Stripe platform invoices are unavailable or the connected account does not match"; }
    }
    const selected = q.kind === "platform_invoice" ? invoices : q.kind === "ai_purchase" ? aiOrders : memberOrders;
    const localTotal = q.kind === "member_order" ? Number(memberTotal?.value || 0) : q.kind === "ai_purchase" ? null : 0;
    const providerMessage = stripeError || (stripeMemberLookupError ? "Some Stripe member payments could not be verified in the connected account" : null);
    res.json({ items: selected, total: providerMessage || q.kind === "platform_invoice" ? null : localTotal, hasMore: q.kind === "platform_invoice" ? stripeHasMore : q.kind === "ai_purchase" ? aiRows.length === q.pageSize : rows.length === q.pageSize, page: q.page, pageSize: q.pageSize, availability: [{ provider: "local", available: true, source: "local", message: null }, { provider: "stripe", available: !providerMessage, source: providerMessage ? "local" : "live", message: providerMessage }] });
  });

  app.post("/api/management/orders/:orderId/refunds", requirePermission("billing.refund"), async (req, res) => {
    const orderId = z.string().trim().min(1).max(200).regex(/^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|in_[A-Za-z0-9]+)$/i, "Invalid order identifier").safeParse(req.params.orderId); if (!issue(res, orderId)) return;
    const body = z.object({ amountMinor: z.number().int().min(1).max(999_999_999), reason, idempotencyKey: z.string().trim().min(8).max(100).regex(/^[A-Za-z0-9_.:-]+$/) }).strict().safeParse(req.body); if (!issue(res, body)) return;
    const [payment] = await db.select().from(webinarPayments).where(eq(webinarPayments.id, orderId.data)).limit(1);
    if (!payment && orderId.data.startsWith("in_")) {
      try {
        const stripe = await getStripe();
        const invoice: any = await stripe.invoices.retrieve(orderId.data, { expand: ["payment_intent.latest_charge"] });
        const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
        const owner = customerId ? await storage.getUserByStripeCustomerId(customerId) : undefined;
        const intent: any = typeof invoice.payment_intent === "string"
          ? await stripe.paymentIntents.retrieve(invoice.payment_intent, { expand: ["latest_charge"] })
          : invoice.payment_intent;
        const intentCustomer = typeof intent?.customer === "string" ? intent.customer : intent?.customer?.id;
        const charge: any = typeof intent?.latest_charge === "string" ? await stripe.charges.retrieve(intent.latest_charge) : intent?.latest_charge;
        if (!owner || !intent || intent.status !== "succeeded" || intentCustomer !== owner.stripeCustomerId) return res.status(409).json({ message: "Stripe invoice payment identity or ownership could not be verified" });
        const mutationKey = `refund:${invoice.id}:${body.data.idempotencyKey}`;
        const fingerprint = `${invoice.id}:stripe:${body.data.amountMinor}`;
        const [previous] = await db.select().from(adminMutationIdempotency).where(eq(adminMutationIdempotency.idempotencyKey, mutationKey)).limit(1);
        if (previous) {
          if (previous.payloadFingerprint !== fingerprint) return res.status(409).json({ message: "Idempotency key was already used with a different refund payload" });
          if (previous.status === "completed") return res.status(202).json({ requested: true, providerReference: previous.providerReference, idempotent: true });
          if (previous.status !== "unknown") return res.status(202).json({ requested: false, providerReference: previous.providerReference, pending: true, idempotent: true });
        }
        const remaining = Number(intent.amount || 0) - Number(charge?.amount_refunded || 0);
        if (body.data.amountMinor > remaining) return res.status(409).json({ message: "Invoice is not eligible for this refund amount" });
        if (!previous) {
          const reserved = await db.insert(adminMutationIdempotency).values({ idempotencyKey: mutationKey, actorUserId: actor(req).id, action: "stripe.invoice_refund.request", targetUserId: owner.id, payloadFingerprint: fingerprint }).onConflictDoNothing().returning({ idempotencyKey: adminMutationIdempotency.idempotencyKey });
          if (!reserved[0]) return res.status(202).json({ requested: false, providerReference: null, pending: true, idempotent: true });
        }
        let refund: any;
        try {
          refund = await stripe.refunds.create({ payment_intent: intent.id, amount: body.data.amountMinor, reason: "requested_by_customer" }, { idempotencyKey: `management-refund:${invoice.id}:${body.data.idempotencyKey}` });
        } catch (error) {
          await db.update(adminMutationIdempotency).set({ status: "unknown" }).where(eq(adminMutationIdempotency.idempotencyKey, mutationKey));
          throw error;
        }
        await db.update(adminMutationIdempotency).set({ status: "completed", providerReference: refund.id }).where(eq(adminMutationIdempotency.idempotencyKey, mutationKey));
        await recordAudit({ actorUserId: actor(req).id, targetUserId: owner.id, action: "stripe.invoice_refund.request", reason: body.data.reason, before: { invoiceId: invoice.id, refundedMinor: Number(charge?.amount_refunded || 0) }, after: { requestedMinor: body.data.amountMinor, refundId: refund.id } });
        return res.status(202).json({ requested: true, providerReference: refund.id });
      } catch (error: any) { return res.status(error.statusCode || 502).json({ message: error.message || "Stripe invoice refund request failed" }); }
    }
    if (!payment) {
      const [aiPurchase] = await db.select({ id: aiPointTransactions.id }).from(aiPointTransactions).where(and(
        eq(aiPointTransactions.id, orderId.data), eq(aiPointTransactions.type, "purchase"),
      )).limit(1);
      if (aiPurchase) return res.status(409).json({ message: "AI point purchases cannot be refunded from this console; use the original verified Stripe checkout support workflow" });
      return res.status(404).json({ message: "Order not found" });
    }
    const mutationKey = `refund:${payment.id}:${body.data.idempotencyKey}`;
    const fingerprint = `${payment.id}:${payment.paymentProvider}:${body.data.amountMinor}`;
    const [priorRefund] = await db.select().from(adminMutationIdempotency).where(eq(adminMutationIdempotency.idempotencyKey, mutationKey)).limit(1);
    if (priorRefund) {
      if (priorRefund.payloadFingerprint !== fingerprint) return res.status(409).json({ message: "Idempotency key was already used with a different refund payload" });
      if (priorRefund.status === "completed") return res.status(202).json({ requested: true, providerReference: priorRefund.providerReference, idempotent: true });
      if (priorRefund.status !== "unknown") return res.status(202).json({ requested: false, providerReference: priorRefund.providerReference, pending: true, idempotent: true });
    }
    if (payment.paymentProvider === "ecpay") { await recordAudit({ actorUserId: actor(req).id, targetUserId: payment.userId, action: "ecpay.refund.external_note", reason: body.data.reason, before: { orderId: payment.id, amountMinor: body.data.amountMinor } }); return res.status(409).json({ message: "ECPay refunds must be handled by the external merchant; an administrative note was recorded" }); }
    if (!payment.stripePaymentIntentId || !payment.userId || body.data.amountMinor > payment.amountMinor - payment.refundedMinor) return res.status(409).json({ message: "Order is not eligible for this refund amount" });
    try {
      const owner = await storage.getUser(payment.userId); if (!owner) return res.status(409).json({ message: "Order owner is unavailable" });
      const stripe = await getStripe(); const intent = await stripe.paymentIntents.retrieve(payment.stripePaymentIntentId);
      // A webinar offer's SaaS owner is the seller. The PaymentIntent customer
      // is the buyer and must not be compared to the seller's subscription
      // customer. Provider metadata and immutable local attribution bind it.
      if (intent.status !== "succeeded" ||
        intent.metadata?.kind !== "webinar_offer" ||
        intent.metadata?.paymentId !== payment.id ||
        intent.metadata?.offerId !== payment.offerId ||
        (payment.webinarId && intent.metadata?.webinarId !== payment.webinarId)) {
        return res.status(409).json({ message: "Stripe payment identity does not match this immutable member order" });
      }
      const reservation = priorRefund?.status === "unknown" ? [{ idempotencyKey: mutationKey }] : await db.insert(adminMutationIdempotency).values({
        idempotencyKey: mutationKey, actorUserId: actor(req).id, action: "stripe.refund.request", targetUserId: owner.id,
        payloadFingerprint: fingerprint,
      }).onConflictDoNothing().returning({ idempotencyKey: adminMutationIdempotency.idempotencyKey });
      if (!reservation[0]) return res.status(202).json({ requested: false, providerReference: null, pending: true, idempotent: true });
      let refund: any;
      try {
        refund = await stripe.refunds.create({ payment_intent: intent.id, amount: body.data.amountMinor, reason: "requested_by_customer" }, { idempotencyKey: `management-refund:${payment.id}:${body.data.idempotencyKey}` });
      } catch (error) {
        await db.update(adminMutationIdempotency).set({ status: "unknown" }).where(eq(adminMutationIdempotency.idempotencyKey, mutationKey));
        throw error;
      }
      await db.update(adminMutationIdempotency).set({ status: "completed", providerReference: refund.id }).where(eq(adminMutationIdempotency.idempotencyKey, mutationKey));
      await recordAudit({ actorUserId: actor(req).id, targetUserId: owner.id, action: "stripe.refund.request", reason: body.data.reason, before: { orderId: payment.id, refundedMinor: payment.refundedMinor }, after: { requestedMinor: body.data.amountMinor, refundId: refund.id } });
      res.status(202).json({ requested: true, providerReference: refund.id });
    } catch (error: any) { res.status(error.statusCode || 502).json({ message: error.message || "Stripe refund request failed" }); }
  });

  app.get("/api/management/support", requirePermission("support.read"), async (req, res) => {
    const parsed = pageSchema.extend({ status: z.enum(["open", "in_progress", "resolved", "closed"]).optional() }).safeParse(req.query); if (!issue(res, parsed)) return;
    const q = parsed.data, terms = []; if (q.userId) terms.push(eq(supportFeedback.userId, q.userId)); if (q.status) terms.push(eq(supportFeedback.status, q.status)); if (q.search) terms.push(or(ilike(supportFeedback.subject, likePattern(q.search)), ilike(supportFeedback.message, likePattern(q.search)))!);
    const where = terms.length ? and(...terms) : undefined;
    const [[total], rows] = await Promise.all([db.select({ value: count() }).from(supportFeedback).where(where), db.select({ support: supportFeedback, username: users.username }).from(supportFeedback).innerJoin(users, eq(supportFeedback.userId, users.id)).where(where).orderBy(desc(supportFeedback.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize)]);
    res.json({ total: Number(total?.value || 0), page: q.page, pageSize: q.pageSize, items: rows.map(row => ({ ...row.support, username: row.username, createdAt: row.support.createdAt.toISOString(), updatedAt: row.support.updatedAt.toISOString() })) });
  });

  app.patch("/api/management/support/:id", requirePermission("support.write"), async (req, res) => {
    const id = uuid.safeParse(req.params.id); if (!issue(res, id)) return;
    const body = z.object({ status: z.enum(["open", "in_progress", "resolved", "closed"]).optional(), adminNote: z.string().trim().max(5000).nullable().optional(), reason }).strict().refine(v => v.status !== undefined || v.adminNote !== undefined, "A support field is required").safeParse(req.body); if (!issue(res, body)) return;
    const [existing] = await db.select().from(supportFeedback).where(eq(supportFeedback.id, id.data)).limit(1); if (!existing) return res.status(404).json({ message: "Support case not found" });
    const updated = await db.transaction(async tx => { const result = await tx.update(supportFeedback).set({ status: body.data.status, adminNote: body.data.adminNote, updatedAt: new Date() }).where(eq(supportFeedback.id, existing.id)).returning(); await tx.insert(adminAuditEvents).values({ actorUserId: actor(req).id, targetUserId: existing.userId, action: "support.update", reason: body.data.reason, before: { status: existing.status, adminNote: existing.adminNote }, after: { status: result[0].status, adminNote: result[0].adminNote } }); return result[0]; });
    const owner = await storage.getUser(updated.userId); res.json({ ...updated, username: owner?.username || "Unknown", createdAt: updated.createdAt.toISOString(), updatedAt: updated.updatedAt.toISOString() });
  });

  const auditQuery = z.object({ page: z.coerce.number().int().min(1).max(10_000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25), targetUserId: z.string().uuid().optional(), action: z.string().trim().max(100).optional() }).strict();
  app.get("/api/management/audit", requirePermission("audit.read"), async (req, res) => {
    const parsed = auditQuery.safeParse(req.query); if (!issue(res, parsed)) return; const q = parsed.data, where = q.targetUserId && q.action ? and(eq(adminAuditEvents.targetUserId, q.targetUserId), eq(adminAuditEvents.action, q.action)) : q.targetUserId ? eq(adminAuditEvents.targetUserId, q.targetUserId) : q.action ? eq(adminAuditEvents.action, q.action) : undefined;
    const [[total], rows] = await Promise.all([db.select({ value: count() }).from(adminAuditEvents).where(where), db.select().from(adminAuditEvents).where(where).orderBy(desc(adminAuditEvents.createdAt), asc(adminAuditEvents.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize)]);
    res.json({ total: Number(total?.value || 0), page: q.page, pageSize: q.pageSize, items: rows.map(row => ({ ...row, createdAt: row.createdAt.toISOString() })) });
  });
  app.get("/api/management/audit/export.csv", requirePermission("audit.export"), async (req, res) => {
    const parsed = auditQuery.extend({ pageSize: z.coerce.number().int().min(1).max(10_000).default(10_000) }).safeParse(req.query); if (!issue(res, parsed)) return; const q = parsed.data, where = q.targetUserId ? eq(adminAuditEvents.targetUserId, q.targetUserId) : q.action ? eq(adminAuditEvents.action, q.action) : undefined;
    const rows = await db.select().from(adminAuditEvents).where(where).orderBy(desc(adminAuditEvents.createdAt)).limit(q.pageSize);
    await recordAudit({ actorUserId: actor(req).id, action: "audit.export", reason: "CSV audit export" });
    const content = [["id", "actorUserId", "targetUserId", "action", "reason", "before", "after", "createdAt"], ...rows.map(row => [row.id, row.actorUserId, row.targetUserId, row.action, row.reason, JSON.stringify(row.before || {}), JSON.stringify(row.after || {}), row.createdAt.toISOString()])].map(line => line.map(csv).join(",")).join("\r\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8"); res.setHeader("Content-Disposition", "attachment; filename=management-audit.csv"); res.send(`\uFEFF${content}`);
  });
}