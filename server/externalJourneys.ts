import crypto from "node:crypto";
import net from "node:net";
import dns from "node:dns/promises";
import type { Express, Request, Response } from "express";
import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import {
  externalBrowserReportSchema, externalHandoffExchangeSchema, externalJourneyPublishSchema, externalJourneySaveSchema,
  externalJourneySettingsSchema, externalMerchantEventSchema, externalOrderListQuerySchema,
  externalReferralRequestSchema, type ExternalJourneySettingsInput,
} from "@shared/externalJourneys";
import {
  ctaButtons, externalHandoffs, externalJourneySettings, externalOrderEvents,
  externalOrders, externalReferrals, memberIntegrationSecrets, registrations, users, webinars, webinarSessions,
} from "@shared/schema";
import { db } from "./db";
import { postgresRateLimit } from "./rateLimit";
import { verifyWatchToken } from "./watchTokens";
import { isNoCardTrialOnlyAccount } from "./noCardTrial";

const DEFAULT_SETTINGS: ExternalJourneySettingsInput = {
  landingMode: "builtin", thankYouMode: "builtin", approvedOrigins: [], approvedEmbedOrigins: [],
  secureHandoffEnabled: false, includeWatchLinkInHandoff: false, includeContactInHandoff: false,
};
const HANDOFF_TTL_MS = 10 * 60_000;
const INTERNAL_PATH = /^\/(?:join|register|form|embed\/register|webinar)(?:\/|$)/i;
const digest = (value: string | Buffer) => crypto.createHash("sha256").update(value).digest("hex");
const opaque = () => crypto.randomBytes(32).toString("base64url");
const originOf = (value: string) => new URL(value).origin;

function integrationKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required");
  return Buffer.from(crypto.hkdfSync("sha256", Buffer.from(secret), Buffer.from("livecast-external-journeys-v1"), Buffer.from("integration-secret/aes-256-gcm/v1"), 32));
}
function encryptSecret(value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", integrationKey(), iv);
  cipher.setAAD(Buffer.from("integration-secret/aes-256-gcm/v1"));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}
function decryptSecret(value: string): string {
  const [version, iv, tag, ciphertext] = value.split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext) throw new Error("Unsupported integration secret");
  const decipher = crypto.createDecipheriv("aes-256-gcm", integrationKey(), Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from("integration-secret/aes-256-gcm/v1"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}
function encryptPrivateValue(value: string): string { return encryptSecret(value); }
function decryptPrivateValue(value: string): string { return decryptSecret(value); }
function safeEqual(a: string, b: string) {
  const aa = Buffer.from(a), bb = Buffer.from(b);
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function isUnsafeHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local")) return true;
  if (!net.isIP(h)) return false;
  if (net.isIPv4(h)) {
    const p = h.split(".").map(Number);
    return p[0] === 0 || p[0] === 10 || p[0] === 127 || p[0] >= 224 || (p[0] === 169 && p[1] === 254)
      || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127);
  }
  // Normalize both URL literals and DNS answers (which may use expanded or
  // dotted IPv6 notation) before applying the embedded IPv4 network policy.
  const ipv6 = new URL(`https://[${h}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([0-9a-f]+):([0-9a-f]+)$/.exec(ipv6);
  if (mapped) {
    const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16);
    return isUnsafeHost(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }
  return ipv6 === "::" || ipv6 === "::1" || ipv6.startsWith("fc") || ipv6.startsWith("fd") || ipv6.startsWith("fe8") || ipv6.startsWith("fe9") || ipv6.startsWith("fea") || ipv6.startsWith("feb");
}
function configuredPlatformHost() {
  try { return process.env.APP_BASE_URL ? new URL(process.env.APP_BASE_URL).host.toLowerCase() : undefined; } catch { return undefined; }
}
export async function assertExternalJourneyUrl(value: string, requestHost?: string) {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || isUnsafeHost(parsed.hostname)) {
    throw new Error("External URL is unsafe");
  }
  if (Array.from(parsed.searchParams.keys()).some(key => /^(email|phone|mobile|name|full_name|fullname|token|watch_?token|access_token|refresh_token|authorization|secret)$/i.test(key))) {
    throw new Error("External destination must not contain contact or credential parameters");
  }
  const platformHosts = [configuredPlatformHost(), requestHost?.toLowerCase()].filter(Boolean);
  if (INTERNAL_PATH.test(parsed.pathname) && platformHosts.includes(parsed.host.toLowerCase())) {
    throw new Error("External URL loops back into a platform journey");
  }
  // DNS is validation only (never an HTTP request) and is bounded so an
  // unresolvable customer hostname cannot silently become an SSRF bypass.
  let addresses: Array<{ address: string }>;
  try {
    addresses = await new Promise<Array<{ address: string }>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("DNS lookup timed out")), 2_000);
      dns.lookup(parsed.hostname, { all: true, verbatim: true }).then(
        result => { clearTimeout(timer); resolve(result); },
        error => { clearTimeout(timer); reject(error); },
      );
    });
  } catch {
    throw new Error("External URL host cannot be resolved");
  }
  if (!addresses.length || addresses.some(({ address }) => isUnsafeHost(address))) {
    throw new Error("External URL cannot target a private network");
  }
  return parsed;
}
function publicSettings(row: any) {
  if (!row?.publishedSettings) return undefined;
  const s = externalJourneySettingsSchema.parse(row.publishedSettings);
  return {
    landingMode: s.landingMode, ...(s.landingMode === "external" ? { landingUrl: s.landingUrl } : {}),
    thankYouMode: s.thankYouMode, approvedOrigins: s.approvedOrigins, approvedEmbedOrigins: s.approvedEmbedOrigins,
  };
}
async function activeOwner(userId: string | undefined) {
  if (!userId) return undefined;
  const [owner] = await db.select({ id: users.id, isActive: users.isActive }).from(users).where(eq(users.id, userId)).limit(1);
  return owner?.isActive ? owner : undefined;
}
async function isPubliclyAvailable(webinarId: string, hasEntitlement: (user: any) => Promise<boolean>) {
  const [webinar] = await db.select().from(webinars).where(eq(webinars.id, webinarId)).limit(1);
  if (!webinar || webinar.publishStatus !== "published" || !webinar.userId) return undefined;
  const owner = await activeOwner(webinar.userId);
  if (!owner || !await hasEntitlement(await db.query.users.findFirst({ where: eq(users.id, webinar.userId) }) as any)) return undefined;
  const [settings] = await db.select().from(externalJourneySettings).where(eq(externalJourneySettings.webinarId, webinarId)).limit(1);
  // Missing configuration is a safe built-in snapshot, preserving old
  // published webinars without ever inventing an external destination.
  return { webinar, settings: settings?.publishedSettings ? settings : { publishedSettings: DEFAULT_SETTINGS } };
}
async function getMemberSecret(userId: string) {
  const [row] = await db.select().from(memberIntegrationSecrets).where(eq(memberIntegrationSecrets.userId, userId)).limit(1);
  return row ? decryptSecret(row.secretEncrypted) : undefined;
}
async function requireMember(req: Request, res: Response) {
  const id = req.session?.userId;
  if (!id) { res.status(401).json({ message: "Unauthorized" }); return; }
  const owner = await activeOwner(id);
  if (!owner) { res.status(403).json({ message: "Forbidden" }); return; }
  return id;
}
async function denyTrialExternalJourney(res: Response, userId: string) {
  if (!await isNoCardTrialOnlyAccount(userId)) return false;
  res.status(403).json({
    message: "EXTERNAL_JOURNEY_REQUIRES_PAID_OR_MANUAL_ENTITLEMENT",
    code: "EXTERNAL_JOURNEY_REQUIRES_PAID_OR_MANUAL_ENTITLEMENT",
  });
  return true;
}
function requestOrigin(req: Request) {
  const origin = req.get("Origin");
  try { return origin ? new URL(origin).origin : undefined; } catch { return undefined; }
}
function setOriginCors(req: Request, res: Response, origins: string[]) {
  const origin = requestOrigin(req);
  if (origin && origins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return true;
  }
  return false;
}
function externalOrderDto(order: any) {
  const unresolved = !order.purchaseObserved;
  return {
    ...order,
    paymentStatus: order.purchaseObserved
      ? order.refundedMinor > 0 ? order.refundedMinor >= order.grossPaidMinor ? "refunded" : "partially_refunded" : "paid"
      : order.refundedMinor > 0 ? "refund_pending" : order.paymentStatus,
    grossPaidMinor: unresolved ? null : order.grossPaidMinor,
    netMinor: unresolved ? null : order.netMinor,
    selectedSession: order.selectedSession?.toISOString?.() || null,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}

/** Called only after registration has been durably created. */
export async function externalThankYouForRegistration(registration: { id: string; webinarId: string; selectedSession?: Date | null }, watchUrl: string, requestHost?: string) {
  const [webinar] = await db.select().from(webinars).where(eq(webinars.id, registration.webinarId)).limit(1);
  if (!webinar?.userId) return undefined;
  const [row] = await db.select().from(externalJourneySettings).where(eq(externalJourneySettings.webinarId, registration.webinarId)).limit(1);
  if (!row?.publishedSettings) return undefined;
  const settings = externalJourneySettingsSchema.parse(row.publishedSettings);
  if (settings.thankYouMode !== "external" || !settings.thankYouUrl) return undefined;
  const url = await assertExternalJourneyUrl(settings.thankYouUrl, requestHost);
  // Attribution is issued at the same durable registration-success boundary,
  // rather than relying on the external page to make a second referral call.
  // An owner can opt out simply by omitting this destination origin from the
  // published reporting allowlist.
  if (settings.approvedOrigins.includes(url.origin)) {
    const scRef = opaque();
    let sessionId: string | null = null;
    if (registration.selectedSession) {
      const [session] = await db.select({ id: webinarSessions.id }).from(webinarSessions).where(and(
        eq(webinarSessions.webinarId, registration.webinarId),
        eq(webinarSessions.scheduledStart, registration.selectedSession),
      )).limit(1);
      sessionId = session?.id || null;
    }
    await db.insert(externalReferrals).values({
      isTest: webinar.isTest || !!(await db.query.registrations.findFirst({ where: eq(registrations.id, registration.id), columns: { isTest: true } }))?.isTest,
      tokenHash: digest(scRef), webinarId: registration.webinarId, ownerId: webinar.userId,
      targetUrl: settings.thankYouUrl, registrationId: registration.id, sessionId,
      selectedSession: registration.selectedSession || null, sessionProvenance: "registration_success",
    } as any);
    url.searchParams.set("sc_ref", scRef);
  }
  if (!settings.secureHandoffEnabled) return { redirectUrl: url.toString() };
  const token = opaque();
  await db.insert(externalHandoffs).values({
    tokenHash: digest(token), webinarId: webinar.id, ownerId: webinar.userId, registrationId: registration.id,
    destinationOrigin: url.origin, includeWatchLink: settings.includeWatchLinkInHandoff, includeContact: settings.includeContactInHandoff,
    ...(settings.includeWatchLinkInHandoff ? { watchUrlEncrypted: encryptPrivateValue(watchUrl) } : {}),
    expiresAt: new Date(Date.now() + HANDOFF_TTL_MS),
  });
  url.searchParams.set("handoff", token);
  // The watch URL is retained only server-side in the handoff exchange response.
  void watchUrl;
  return { redirectUrl: url.toString(), handoffExpiresInSeconds: HANDOFF_TTL_MS / 1000 };
}

async function applyExternalEvent(tx: any, input: {
  ownerId: string; webinarId: string; orderId: string; eventId: string; eventType: "purchase" | "refund" | "pending" | "failed";
  isTest?: boolean;
  sourceTrust: "browser_reported" | "merchant_reported"; amountMinor: number; currency: string; fingerprint: string; referralId?: string | null; sessionId?: string | null; selectedSession?: Date | null; occurredAt?: Date;
}) {
  // Serialise every aggregate transition, including the first event for an
  // order where there is no row yet to lock.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`external-event:${input.ownerId}:${input.eventId}`}))`);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${input.ownerId}:${input.webinarId}:${input.orderId}`}))`);
  const [known] = await tx.select().from(externalOrderEvents).where(and(
    eq(externalOrderEvents.ownerId, input.ownerId),
    eq(externalOrderEvents.eventId, input.eventId),
  )).limit(1);
  if (known) {
    if (known.webinarId !== input.webinarId) throw Object.assign(new Error("Event belongs to another webinar"), { status: 409 });
    if (known.payloadFingerprint !== input.fingerprint) throw Object.assign(new Error("Event ID was already used with a different payload"), { status: 409 });
    return { replayed: true, orderId: known.orderId };
  }
  await tx.execute(sql`SELECT id FROM external_orders WHERE owner_id = ${input.ownerId} AND webinar_id = ${input.webinarId} AND order_id = ${input.orderId} FOR UPDATE`);
  const [existing] = await tx.select().from(externalOrders).where(and(
    eq(externalOrders.ownerId, input.ownerId), eq(externalOrders.webinarId, input.webinarId),
    eq(externalOrders.orderId, input.orderId),
  )).limit(1);
  // A public browser report is an unverified observation, never a reservation
  // of a merchant's future order identity/currency/webinar. Authenticated
  // merchant evidence replaces that provisional aggregate. Conflicting
  // merchant-to-merchant currency is still an explicit integrity error.
  if (existing && existing.currency !== input.currency && existing.sourceTrust === "merchant_reported" && input.sourceTrust === "merchant_reported") {
    throw Object.assign(new Error("An order cannot mix currencies"), { status: 409 });
  }
  if (existing && existing.isTest !== !!input.isTest) {
    throw Object.assign(new Error("Order test classification cannot change"), { status: 409 });
  }
  const sameLedger = existing?.sourceTrust === input.sourceTrust;
  if (sameLedger && existing.purchaseObserved && input.eventType === "purchase" && existing.grossPaidMinor !== input.amountMinor) {
    throw Object.assign(new Error("Paid order amount is immutable"), { status: 409 });
  }
  const inserted = await tx.insert(externalOrderEvents).values({
    ownerId: input.ownerId, webinarId: input.webinarId, orderId: input.orderId, eventId: input.eventId, eventType: input.eventType,
    sourceTrust: input.sourceTrust, amountMinor: input.amountMinor, currency: input.currency, payloadFingerprint: input.fingerprint,
    referralId: input.referralId || null, sessionId: input.sessionId || null, selectedSession: input.selectedSession || null, occurredAt: input.occurredAt || new Date(),
    isTest: !!input.isTest,
  }).onConflictDoNothing().returning({ id: externalOrderEvents.id });
  if (!inserted.length) {
    const [replayed] = await tx.select().from(externalOrderEvents).where(and(
      eq(externalOrderEvents.ownerId, input.ownerId), eq(externalOrderEvents.webinarId, input.webinarId),
      eq(externalOrderEvents.eventId, input.eventId),
    )).limit(1);
    if (!replayed || replayed.payloadFingerprint !== input.fingerprint) throw Object.assign(new Error("Event ID was already used with a different payload"), { status: 409 });
    return { replayed: true, orderId: replayed.orderId };
  }
  // Browser reports never modify a merchant-authenticated aggregate. Once a
  // merchant event arrives, its own ledger replaces the browser estimate.
  if (existing && existing.sourceTrust === "merchant_reported" && input.sourceTrust === "browser_reported") return { replayed: false, orderId: existing.id };
  const base = !existing || (existing.sourceTrust === "browser_reported" && input.sourceTrust === "merchant_reported")
    ? { gross: 0, refunded: 0, purchaseObserved: false }
    : { gross: existing.grossPaidMinor, refunded: existing.refundedMinor, purchaseObserved: existing.purchaseObserved };
  const gross = input.eventType === "purchase" && !base.purchaseObserved ? input.amountMinor : base.gross;
  // Merchant refund values are cumulative refund-to-date, not deltas. A late
  // or duplicate-equivalent refund therefore cannot push net below zero.
  const refunded = input.eventType === "refund" ? Math.max(base.refunded, input.amountMinor) : base.refunded;
  const purchaseObserved = base.purchaseObserved || input.eventType === "purchase";
  const paymentStatus = purchaseObserved
    ? refunded > 0 ? (refunded >= gross ? "refunded" : "partially_refunded") : "paid"
    : refunded > 0 ? "refund_pending" : input.eventType === "failed" ? "failed" : "pending";
  const values = {
    webinarId: input.webinarId, currency: input.currency, sourceTrust: input.sourceTrust,
    purchaseObserved, grossPaidMinor: gross, paymentStatus, isTest: !!input.isTest,
    refundedMinor: refunded, netMinor: Math.max(0, gross - refunded), referralId: input.referralId || existing?.referralId || null, sessionId: input.sessionId || existing?.sessionId || null, selectedSession: input.selectedSession || existing?.selectedSession || null, updatedAt: new Date(),
  };
  if (existing) await tx.update(externalOrders).set(values).where(eq(externalOrders.id, existing.id));
  else await tx.insert(externalOrders).values({ ownerId: input.ownerId, orderId: input.orderId, ...values });
  return { replayed: false, orderId: existing?.id, orderDeduplicated: !!(sameLedger && existing?.purchaseObserved && input.eventType === "purchase") };
}

export function registerExternalJourneyRoutes(app: Express, hasEntitlement: (user: any) => Promise<boolean>) {
  const reportLimit = postgresRateLimit({ namespace: "external-browser-report", limit: 30, windowSeconds: 60 });
  app.get("/api/member/external-journeys/connection", async (req, res) => {
    const userId = await requireMember(req, res); if (!userId) return;
    const [secret] = await db.select({ version: memberIntegrationSecrets.version, rotatedAt: memberIntegrationSecrets.rotatedAt }).from(memberIntegrationSecrets).where(eq(memberIntegrationSecrets.userId, userId)).limit(1);
    res.json({ connected: Boolean(secret), version: secret?.version || null, rotatedAt: secret?.rotatedAt?.toISOString() || null, merchantEventsPath: "/api/external/merchant-events/:webinarId", handoffExchangePath: "/api/external/handoffs/exchange" });
  });
  app.post("/api/member/external-journeys/connection/rotate", async (req, res) => {
    const userId = await requireMember(req, res); if (!userId) return;
    const secret = opaque();
    const [existing] = await db.select().from(memberIntegrationSecrets).where(eq(memberIntegrationSecrets.userId, userId)).limit(1);
    if (existing) await db.update(memberIntegrationSecrets).set({ secretEncrypted: encryptSecret(secret), version: existing.version + 1, rotatedAt: new Date() }).where(eq(memberIntegrationSecrets.userId, userId));
    else await db.insert(memberIntegrationSecrets).values({ userId, secretEncrypted: encryptSecret(secret) });
    res.status(201).json({ secret, warning: "Copy this secret now. It cannot be shown again." });
  });
  app.get("/api/member/external-journeys/events", async (req, res) => {
    try {
      const ownerId = await requireMember(req, res); if (!ownerId) return;
      const rows = await db.select({
        id: externalOrderEvents.id, webinarId: externalOrderEvents.webinarId, orderId: externalOrderEvents.orderId,
        eventId: externalOrderEvents.eventId, eventType: externalOrderEvents.eventType, sourceTrust: externalOrderEvents.sourceTrust,
        amountMinor: externalOrderEvents.amountMinor, currency: externalOrderEvents.currency, occurredAt: externalOrderEvents.occurredAt, createdAt: externalOrderEvents.createdAt,
      }).from(externalOrderEvents).where(eq(externalOrderEvents.ownerId, ownerId)).orderBy(desc(externalOrderEvents.createdAt)).limit(100);
      // This is deliberately a receipt/event log: fingerprints, signatures,
      // headers, raw JSON, registration PII, and secrets are never exposed.
      res.json({ items: rows.map(row => ({ ...row, occurredAt: row.occurredAt.toISOString(), createdAt: row.createdAt.toISOString() })) });
    } catch (error: any) { res.status(400).json({ message: error.message }); }
  });
  app.get("/api/webinars/:id/external-journey", async (req, res) => {
    const userId = await requireMember(req, res); if (!userId) return;
    if (await denyTrialExternalJourney(res, userId)) return;
    const [webinar] = await db.select().from(webinars).where(and(eq(webinars.id, String(req.params.id)), eq(webinars.userId, userId))).limit(1);
    if (!webinar) return res.status(404).json({ message: "Webinar not found" });
    const [row] = await db.select().from(externalJourneySettings).where(eq(externalJourneySettings.webinarId, webinar.id)).limit(1);
    res.json({ version: row?.version || 1, settings: row?.settings || DEFAULT_SETTINGS, publishedAt: row?.publishedAt || null });
  });
  app.put("/api/webinars/:id/external-journey", async (req, res) => {
    try {
      const userId = await requireMember(req, res); if (!userId) return;
      if (await denyTrialExternalJourney(res, userId)) return;
      const input = externalJourneySaveSchema.parse(req.body);
      for (const candidate of [...input.settings.approvedOrigins, ...input.settings.approvedEmbedOrigins, ...[input.settings.landingUrl, input.settings.thankYouUrl].filter(Boolean) as string[]]) await assertExternalJourneyUrl(candidate, req.get("host") || undefined);
      const [webinar] = await db.select().from(webinars).where(and(eq(webinars.id, String(req.params.id)), eq(webinars.userId, userId))).limit(1);
      if (!webinar) return res.status(404).json({ message: "Webinar not found" });
      const [row] = await db.select().from(externalJourneySettings).where(eq(externalJourneySettings.webinarId, webinar.id)).limit(1);
      if (row) {
        if (row.version !== input.version) return res.status(409).json({ message: "Version conflict", code: "VERSION_CONFLICT" });
        const [updated] = await db.update(externalJourneySettings).set({ settings: input.settings, version: row.version + 1, updatedAt: new Date() }).where(and(eq(externalJourneySettings.webinarId, webinar.id), eq(externalJourneySettings.version, input.version))).returning();
        if (!updated) return res.status(409).json({ message: "Version conflict", code: "VERSION_CONFLICT" });
        return res.json(updated);
      }
      if (input.version !== 1) return res.status(409).json({ message: "Version conflict", code: "VERSION_CONFLICT" });
      const [created] = await db.insert(externalJourneySettings).values({ webinarId: webinar.id, settings: input.settings }).returning();
      res.status(201).json(created);
    } catch (error: any) { res.status(error?.status || 400).json({ message: error.message }); }
  });
  app.post("/api/webinars/:id/external-journey/publish", async (req, res) => {
    try {
      const userId = await requireMember(req, res); if (!userId) return;
      if (await denyTrialExternalJourney(res, userId)) return;
      const input = externalJourneyPublishSchema.parse(req.body);
      const [webinar] = await db.select().from(webinars).where(and(eq(webinars.id, String(req.params.id)), eq(webinars.userId, userId))).limit(1);
      if (!webinar || webinar.publishStatus !== "published") return res.status(409).json({ message: "Publish the webinar before publishing its external journey" });
      const [row] = await db.select().from(externalJourneySettings).where(eq(externalJourneySettings.webinarId, webinar.id)).limit(1);
      if (!row || row.version !== input.version) return res.status(409).json({ message: "Version conflict", code: "VERSION_CONFLICT" });
      const settings = externalJourneySettingsSchema.parse(row.settings);
      for (const candidate of [...settings.approvedOrigins, ...settings.approvedEmbedOrigins, ...[settings.landingUrl, settings.thankYouUrl].filter(Boolean) as string[]]) await assertExternalJourneyUrl(candidate, req.get("host") || undefined);
      const [published] = await db.update(externalJourneySettings).set({ publishedSettings: settings, publishedAt: new Date(), updatedAt: new Date() }).where(and(eq(externalJourneySettings.webinarId, webinar.id), eq(externalJourneySettings.version, input.version))).returning();
      if (!published) return res.status(409).json({ message: "Version conflict", code: "VERSION_CONFLICT" });
      res.json(published);
    } catch (error: any) { res.status(error?.status || 400).json({ message: error.message }); }
  });
  app.get("/api/webinars/:id/external-journey/public", async (req, res) => {
    const available = await isPubliclyAvailable(String(req.params.id), hasEntitlement);
    if (!available) return res.status(404).json({ message: "Not found" });
    res.json(publicSettings(available.settings));
  });
  const journeyRedirect = async (req: Request, res: Response, next: Function) => {
    // The SPA preview subsequently calls the owner-only preview API. Do not
    // redirect its route before that authorization check can happen.
    if (req.path.startsWith("/register/") && req.query.preview === "1") return next();
    const available = await isPubliclyAvailable(String(req.params.id), hasEntitlement);
    if (!available) return res.status(404).send("Not found");
    const s = externalJourneySettingsSchema.parse(available.settings.publishedSettings!);
    const inbound = new URL(req.originalUrl, "http://internal.invalid").searchParams;
    if (s.landingMode === "external" && s.landingUrl) {
      const destination = await assertExternalJourneyUrl(s.landingUrl, req.get("host") || undefined);
      // Do not turn an arbitrary public share query into external data
      // leakage. Only the bounded standard UTM set is propagated.
      for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]) {
        for (const value of inbound.getAll(key)) if (value.length <= 200) destination.searchParams.append(key, value);
      }
      return res.redirect(302, destination.toString());
    }
    // Built-in registration is not an external trust boundary: retain all
    // existing UTM/prefill/session query parameters for compatibility.
    const query = inbound.toString();
    return res.redirect(302, `/form/${encodeURIComponent(available.webinar.id)}${query ? `?${query}` : ""}`);
  };
  app.get("/join/:id", journeyRedirect); app.get("/register/:id", journeyRedirect);
  app.post("/api/webinars/:id/external-referrals", async (req, res) => {
    try {
      const available = await isPubliclyAvailable(String(req.params.id), hasEntitlement);
      if (!available) return res.status(404).json({ message: "Not found" });
      const input = externalReferralRequestSchema.parse(req.body);
      const settings = externalJourneySettingsSchema.parse(available.settings.publishedSettings!);
      const target = await assertExternalJourneyUrl(input.targetUrl);
      if (!settings.approvedOrigins.includes(target.origin)) return res.status(403).json({ message: "Target origin is not approved" });
      let cta: any;
      if (input.targetKind === "cta") {
        [cta] = await db.select().from(ctaButtons).where(and(eq(ctaButtons.id, input.ctaId!), eq(ctaButtons.webinarId, available.webinar.id), eq(ctaButtons.url, input.targetUrl), sql`${ctaButtons.archivedAt} IS NULL`)).limit(1);
        if (!cta) return res.status(403).json({ message: "CTA target is not a persisted allowed target" });
      } else if (settings.thankYouMode !== "external" || settings.thankYouUrl !== input.targetUrl) {
        return res.status(403).json({ message: "Target is not the published thank-you destination" });
      }
      // A bearer watch token is verified cryptographically. Neither
      // registrationId nor a claimed session from the browser is trusted.
      const token = verifyWatchToken(req.get("X-Watch-Token"));
      let registration: any;
      if (token?.webinarId === available.webinar.id) {
        [registration] = await db.select().from(registrations).where(and(eq(registrations.id, token.registrationId), eq(registrations.webinarId, available.webinar.id), isNull(registrations.deletedAt))).limit(1);
      }
      if (req.get("X-Watch-Token") && !registration) return res.status(401).json({ message: "Invalid attribution identity" });
      let declaredSession: any;
      let selectedSession: Date | null = registration?.selectedSession || null;
      if (!registration && input.sessionId) {
        [declaredSession] = await db.select({ id: webinarSessions.id }).from(webinarSessions).where(and(eq(webinarSessions.id, input.sessionId), eq(webinarSessions.webinarId, available.webinar.id))).limit(1);
        if (!declaredSession) return res.status(403).json({ message: "Session does not belong to this webinar" });
      } else if (registration?.selectedSession) {
        [declaredSession] = await db.select({ id: webinarSessions.id }).from(webinarSessions).where(and(eq(webinarSessions.webinarId, available.webinar.id), eq(webinarSessions.scheduledStart, registration.selectedSession))).limit(1);
      }
      const scRef = opaque(), visitId = input.visitId || opaque();
      const [row] = await db.insert(externalReferrals).values({
        tokenHash: digest(scRef), webinarId: available.webinar.id, ownerId: available.webinar.userId!,
        // Thank-you destinations do not have a CTA row; retain a non-null
        // FK-compatible CTA only for normal CTA attribution.
        ...(cta ? { ctaId: cta.id } : {}),
        targetUrl: target.toString(), registrationId: registration?.id || null,
        sessionId: declaredSession?.id || null, selectedSession,
        sessionProvenance: registration ? "registered_watch_token" : declaredSession ? "declared_session" : "anonymous",
        visitHash: digest(visitId),
        isTest: available.webinar.isTest || !!registration?.isTest,
      } as any).returning();
      res.status(201).json({ scRef, visitId, redirectUrl: `/r/${scRef}`, referralId: row.id });
    } catch (error: any) { res.status(400).json({ message: error.message }); }
  });
  app.get("/r/:scRef", async (req, res) => {
    const token = String(req.params.scRef);
    if (!/^[A-Za-z0-9_-]{24,128}$/.test(token)) return res.status(404).send("Not found");
    const [referral] = await db.select().from(externalReferrals).where(eq(externalReferrals.tokenHash, digest(token))).limit(1);
    if (!referral) return res.status(404).send("Not found");
    const url = await assertExternalJourneyUrl(referral.targetUrl, req.get("host") || undefined); url.searchParams.set("sc_ref", token);
    res.redirect(302, url.toString());
  });
  app.options("/api/external/reported", async (req, res) => {
    const scRef = typeof req.query.scRef === "string" ? req.query.scRef : "";
    const [referral] = /^[A-Za-z0-9_-]{24,128}$/.test(scRef)
      ? await db.select().from(externalReferrals).where(eq(externalReferrals.tokenHash, digest(scRef))).limit(1)
      : [];
    const available = referral ? await isPubliclyAvailable(referral.webinarId, hasEntitlement) : undefined;
    let origins = available ? externalJourneySettingsSchema.parse(available.settings.publishedSettings!).approvedOrigins : [];
    // A browser preflight happens before its JSON body is sent. The installed
    // snippet may not put sc_ref in the endpoint query, so allow a preflight
    // only when this exact Origin exists in a currently published journey.
    if (!origins.length && requestOrigin(req)) {
      const origin = requestOrigin(req)!;
      const candidates = await db.select({ webinarId: externalJourneySettings.webinarId }).from(externalJourneySettings)
        .where(sql`${externalJourneySettings.publishedSettings} -> 'approvedOrigins' ? ${origin}`).limit(1);
      if (candidates[0] && await isPubliclyAvailable(candidates[0].webinarId, hasEntitlement)) origins = [origin];
    }
    if (!setOriginCors(req, res, origins)) return res.sendStatus(403); res.sendStatus(204);
  });
  app.post("/api/external/reported", reportLimit, async (req, res) => {
    try {
      if (Buffer.isBuffer(req.rawBody) && req.rawBody.length > 4_096) return res.status(413).json({ message: "Report payload is too large" });
      const input = externalBrowserReportSchema.parse(req.body);
      const [referral] = await db.select().from(externalReferrals).where(eq(externalReferrals.tokenHash, digest(input.scRef))).limit(1);
      if (!referral) return res.status(404).json({ message: "Unknown attribution" });
      const available = await isPubliclyAvailable(referral.webinarId, hasEntitlement);
      if (!available) return res.status(404).json({ message: "Unknown attribution" });
      const origins = externalJourneySettingsSchema.parse(available.settings.publishedSettings!).approvedOrigins;
      if (!setOriginCors(req, res, origins)) return res.status(403).json({ message: "Origin is not approved" });
      const fingerprint = digest(JSON.stringify(input));
      const result = await db.transaction(tx => applyExternalEvent(tx, { ownerId: referral.ownerId, webinarId: referral.webinarId, orderId: input.orderId, eventId: `browser:${digest(input.scRef)}:${digest(input.orderId)}`, eventType: "purchase", sourceTrust: "browser_reported", amountMinor: input.amountMinor, currency: input.currency, fingerprint, referralId: referral.id, sessionId: referral.sessionId, selectedSession: referral.selectedSession, isTest: referral.isTest || available.webinar.isTest }));
      res.status(result.replayed ? 200 : 201).json({ accepted: true, unverified: true, replayed: result.replayed });
    } catch (error: any) { res.status(error?.status || 400).json({ message: error.message }); }
  });
  app.post("/api/external/merchant-events/:webinarId", async (req, res) => {
    try {
      const raw = Buffer.isBuffer(req.rawBody) ? req.rawBody : undefined;
      const timestamp = String(req.get("X-External-Timestamp") || "");
      const signature = String(req.get("X-External-Signature") || "");
      if (!raw || raw.length > 16_384 || !/^\d{10}$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp) * 1000) > 5 * 60_000) return res.status(401).json({ message: "Invalid signature timestamp" });
      const [webinar] = await db.select().from(webinars).where(eq(webinars.id, String(req.params.webinarId))).limit(1);
      if (!webinar?.userId) return res.status(404).json({ message: "Not found" });
      const secret = await getMemberSecret(webinar.userId);
      if (!secret) return res.status(401).json({ message: "Invalid signature" });
      const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.`).update(raw).digest("hex");
      if (!/^[a-f0-9]{64}$/i.test(signature) || !safeEqual(signature.toLowerCase(), expected)) return res.status(401).json({ message: "Invalid signature" });
      const input = externalMerchantEventSchema.parse(JSON.parse(raw.toString("utf8")));
      if (input.webinarId && input.webinarId !== webinar.id) return res.status(403).json({ message: "Signed webinar does not match request" });
      let referral: any;
      if (input.scRef) {
        [referral] = await db.select().from(externalReferrals).where(and(
          eq(externalReferrals.tokenHash, digest(input.scRef)), eq(externalReferrals.webinarId, webinar.id), eq(externalReferrals.ownerId, webinar.userId),
        )).limit(1);
        if (!referral) return res.status(403).json({ message: "Attribution does not belong to this webinar" });
      }
      const linkedRegistration = referral?.registrationId
        ? await db.query.registrations.findFirst({ where: eq(registrations.id, referral.registrationId), columns: { isTest: true } }) : undefined;
      const fingerprint = digest(raw);
      const eventType = input.type || (input.status === "paid" ? "purchase" : input.status === "refunded" ? "refund" : input.status!);
      const result = await db.transaction(tx => applyExternalEvent(tx, {
        ownerId: webinar.userId!, webinarId: webinar.id, orderId: input.orderId,
        // Keep untrusted and merchant event-id spaces disjoint. A public
        // report can never consume a merchant's idempotency key.
        eventId: `merchant:${input.eventId}`, eventType, sourceTrust: "merchant_reported",
        amountMinor: input.amountMinor, currency: input.currency, fingerprint, referralId: referral?.id,
        sessionId: referral?.sessionId, selectedSession: referral?.selectedSession,
        occurredAt: input.occurredAt ? new Date(input.occurredAt) : undefined,
        isTest: !!(input.isTest || webinar.isTest || referral?.isTest || linkedRegistration?.isTest),
      }));
      res.status(result.replayed ? 200 : 201).json({ accepted: true, sourceTrust: "merchant_reported", replayed: result.replayed,
        orderDeduplicated: "orderDeduplicated" in result ? result.orderDeduplicated : false });
    } catch (error: any) { res.status(error?.status || 400).json({ message: error.message }); }
  });
  app.post("/api/external/handoffs/exchange", async (req, res) => {
    try {
      const token = externalHandoffExchangeSchema.parse(req.body).handoff;
      const [handoff] = await db.select().from(externalHandoffs).where(eq(externalHandoffs.tokenHash, digest(token))).limit(1);
      if (!handoff || handoff.usedAt || handoff.expiresAt <= new Date()) return res.status(401).json({ message: "Handoff is expired or already used" });
      const secret = await getMemberSecret(handoff.ownerId);
      const bearer = req.get("Authorization")?.replace(/^Bearer\s+/i, "") || "";
      if (!secret || !safeEqual(bearer, secret)) return res.status(401).json({ message: "Invalid integration secret" });
      const declaredOrigin = req.get("Origin") || req.get("X-External-Destination");
      if (!declaredOrigin || originOf(declaredOrigin) !== handoff.destinationOrigin) return res.status(403).json({ message: "Handoff destination mismatch" });
      const [used] = await db.update(externalHandoffs).set({ usedAt: new Date() }).where(and(eq(externalHandoffs.id, handoff.id), sql`${externalHandoffs.usedAt} IS NULL`, sql`${externalHandoffs.expiresAt} > now()`)).returning();
      if (!used) return res.status(401).json({ message: "Handoff is expired or already used" });
      const [registration] = await db.select().from(registrations).where(eq(registrations.id, handoff.registrationId)).limit(1);
      if (!registration) return res.status(404).json({ message: "Registration not found" });
      res.json({
        registrationId: registration.id, webinarId: registration.webinarId, selectedSession: registration.selectedSession?.toISOString?.() || null,
        ...(handoff.includeWatchLink && handoff.watchUrlEncrypted ? { watchUrl: decryptPrivateValue(handoff.watchUrlEncrypted) } : {}),
        // Contact is never encoded in the URL and is exposed only after both
        // the one-use destination-bound handoff and member secret validate.
        ...(handoff.includeContact ? { contact: { name: registration.name, email: registration.email } } : {}),
      });
    } catch (error: any) { res.status(400).json({ message: error.message }); }
  });
  const listConditions = (ownerId: string, q: any) => [eq(externalOrders.ownerId, ownerId), eq(externalOrders.isTest, false),
    sql`NOT EXISTS (SELECT 1 FROM webinars w WHERE w.id = ${externalOrders.webinarId} AND w.is_test = true)`,
    sql`NOT EXISTS (SELECT 1 FROM external_referrals f LEFT JOIN registrations r ON r.id = f.registration_id
      WHERE f.id = ${externalOrders.referralId} AND (f.is_test = true OR r.is_test = true))`,
    ...(q.sourceTrust ? [eq(externalOrders.sourceTrust, q.sourceTrust)] : []), ...(q.sessionId ? [eq(externalOrders.sessionId, q.sessionId)] : []), ...(q.currency ? [eq(externalOrders.currency, q.currency)] : []), ...(q.q ? [ilike(externalOrders.orderId, `%${q.q}%`)] : []), ...(q.from ? [sql`${externalOrders.createdAt} >= ${new Date(q.from)}`] : []), ...(q.to ? [sql`${externalOrders.createdAt} <= ${new Date(q.to)}`] : [])];
  app.get("/api/member/external-orders/summary", async (req, res) => {
    try { const ownerId = await requireMember(req, res); if (!ownerId) return; const q = externalOrderListQuerySchema.parse({ ...req.query, page: 1, pageSize: 1 }); const rows = await db.select({ currency: externalOrders.currency, trust: externalOrders.sourceTrust, gross: sql<number>`coalesce(sum(${externalOrders.grossPaidMinor}) filter (where ${externalOrders.purchaseObserved}), 0)`, refunded: sql<number>`coalesce(sum(${externalOrders.refundedMinor}) filter (where ${externalOrders.purchaseObserved}), 0)`, net: sql<number>`coalesce(sum(${externalOrders.netMinor}) filter (where ${externalOrders.purchaseObserved}), 0)`, count: sql<number>`count(*) filter (where ${externalOrders.purchaseObserved})`, pending: sql<number>`count(*) filter (where not ${externalOrders.purchaseObserved})` }).from(externalOrders).where(and(...listConditions(ownerId, q))).groupBy(externalOrders.currency, externalOrders.sourceTrust); res.json({ labelled: "External reports; not provider-verified revenue", currencies: rows.map(x => ({ currency: x.currency, sourceTrust: x.trust, grossPaidMinor: Number(x.gross), refundedMinor: Number(x.refunded), netMinor: Number(x.net), count: Number(x.count), pendingCount: Number(x.pending) })) }); } catch (error: any) { res.status(400).json({ message: error.message }); }
  });
  app.get("/api/member/external-orders", async (req, res) => {
    try { const ownerId = await requireMember(req, res); if (!ownerId) return; const q = externalOrderListQuerySchema.parse(req.query); const where = and(...listConditions(ownerId, q)); const [items, count] = await Promise.all([db.select().from(externalOrders).where(where).orderBy(desc(externalOrders.createdAt), desc(externalOrders.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize), db.select({ count: sql<number>`count(*)` }).from(externalOrders).where(where)]); res.json({ items: items.map(externalOrderDto), page: q.page, pageSize: q.pageSize, total: Number(count[0]?.count || 0), labelled: "External reports; not provider-verified revenue" }); } catch (error: any) { res.status(400).json({ message: error.message }); }
  });
  app.get("/api/member/external-orders/export.csv", async (req, res) => {
    try { const ownerId = await requireMember(req, res); if (!ownerId) return; const q = externalOrderListQuerySchema.parse({ ...req.query, page: 1, pageSize: 1 }); const rows = await db.select().from(externalOrders).where(and(...listConditions(ownerId, q))).orderBy(desc(externalOrders.createdAt)).limit(10_001); const esc = (x: unknown) => `"${String(x ?? "").replace(/"/g, "\"\"").replace(/^(=|\+|-|@)/, "'$&")}"`; res.setHeader("Content-Type", "text/csv; charset=utf-8"); res.setHeader("X-Export-Truncated", String(rows.length > 10_000)); res.send([["orderId","webinarId","sessionId","selectedSession","sourceTrust","currency","purchaseObserved","grossPaidMinor","refundedMinor","netMinor","createdAt"].map(esc).join(","), ...rows.slice(0, 10_000).map(x => [x.orderId,x.webinarId,x.sessionId,x.selectedSession?.toISOString?.() || "",x.sourceTrust,x.currency,x.purchaseObserved,x.purchaseObserved ? x.grossPaidMinor : "unknown",x.refundedMinor,x.purchaseObserved ? x.netMinor : "unknown",x.createdAt.toISOString()].map(esc).join(","))].join("\r\n")); } catch (error: any) { res.status(400).json({ message: error.message }); }
  });
  app.get("/api/member/external-orders/:id", async (req, res) => {
    try { const ownerId = await requireMember(req, res); if (!ownerId) return; const [order] = await db.select().from(externalOrders).where(and(eq(externalOrders.id, String(req.params.id)), eq(externalOrders.ownerId, ownerId))).limit(1); if (!order) return res.status(404).json({ message: "Order not found" }); const events = await db.select({ id: externalOrderEvents.id, eventId: externalOrderEvents.eventId, eventType: externalOrderEvents.eventType, sourceTrust: externalOrderEvents.sourceTrust, amountMinor: externalOrderEvents.amountMinor, currency: externalOrderEvents.currency, occurredAt: externalOrderEvents.occurredAt }).from(externalOrderEvents).where(and(eq(externalOrderEvents.ownerId, ownerId), eq(externalOrderEvents.webinarId, order.webinarId), eq(externalOrderEvents.orderId, order.orderId))).orderBy(externalOrderEvents.createdAt); res.json({ ...externalOrderDto(order), events: events.map(x => ({ ...x, occurredAt: x.occurredAt.toISOString() })), labelled: "Read-only external report; not provider-verified revenue" }); } catch (error: any) { res.status(400).json({ message: error.message }); }
  });
}