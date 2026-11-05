import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { registerMcpRoutes } from "./mcp/routes";
import { embedFramePolicy } from "./embedFramePolicy";
import multer from "multer";
import path from "path";
import fs from "fs";
import { z } from "zod";
import { NO_CARD_TRIAL_AI_CALL_LIMIT, NO_CARD_TRIAL_DAYS } from "@shared/noCardTrial";
import { storage } from "./storage";
import { sendQuestionNotificationEmail } from "./gmail";
import { createEmailRemindersForRegistration, startEmailScheduler } from "./email-scheduler";
import { generateRecurringSessions, getAvailableSessions, normalizeSelectedSession, scheduleDateBounds } from "./webinarScheduling";
import { createJitSelectionToken, createWatchToken, verifyJitSelectionToken, verifyWatchToken, verifyWatchTokenFor, watchTokenExpiry, viewerChatSessionId } from "./watchTokens";
import crypto from "crypto";
import { safeUploadContentType, verifyImageUpload } from "./safeImageUpload";
import { getUploadStorage, uploadObjectKey } from "./uploadStorage";
import { getBunnyMediaClient, MAX_IMAGE_BYTES, type BunnyMediaClient } from "./bunnyMedia";
import { deleteOwnedMediaAsset, registerBunnyMediaRoutes, resolveReadyOwnedVideoAsset } from "./bunnyMediaRoutes";
import { withMediaReferenceLock } from "./mediaReferenceLock";
import {
  insertWebinarSchema,
  insertRegistrationSchema,
  insertFakeUserSchema,
  insertScheduledMessageSchema,
  insertCtaButtonSchema,
  insertPollSchema,
  insertTipSchema,
  insertQuestionSchema,
  insertFeedbackSurveySchema,
  insertFeedbackResponseSchema,
  insertViewerProgressSchema,
  insertWebinarSessionSchema,
  insertWebhookSchema,
  insertEmailSequenceSchema,
  insertSocialPostSchema,
  insertSupportFeedbackSchema,
  webinarTrackingSettingsSchema,
  metaPixelIdSchema,
  gtmContainerIdSchema,
  analyticsVisitorTokenSchema,
  safeCtaUrlSchema,
  createWebinarOfferSchema,
  users,
  memberAdminMetadata,
  ecpayConnections,
  webinarPayments,
  webhookDeliveries,
  webhooks,
  uploadedAssets,
  mediaAssets,
  registrations,
  offerSalesPages,
  webinarOffers,
  ctaButtons,
  webinars,
} from "@shared/schema";
import {
  createWebinarLandingPageSchema,
  updateWebinarLandingPageSchema,
  webinarLandingVersionSchema,
  defaultWebinarLandingTemplate,
  DEFAULT_WEBINAR_LANDING_BRAND,
  webinarLandingPageCanPublish,
} from "./webinarLandingPages";
import { db } from "./db";
import { and, eq, inArray, isNull, sql, lte, or } from "drizzle-orm";
import { generateInteractions, generateEmailSequence, generateSocialPosts, generateWebinarPlan, getWebinarKnowledge } from "./aiGenerator";

import bcrypt from "bcryptjs";
import { clerkClient, getAuth } from "@clerk/express";
import { getUncachableStripeClient, getStripePublishableKey } from "./stripeClient";
import { looksLikeQuestion } from "./aiAssistant";
import { runAiReply } from "./aiReplyService";
import { aiReplyAdmission, executeAdmittedAiReply, validateViewerChatContent } from "./aiReplyAdmission";
import { registerAiManagementRoutes } from "./aiManagementRoutes";
import { activePublishingOverride, registerAdminManagementRoutes } from "./adminManagementRoutes";
import {
  activeMemberManualPlan,
  composePublishingOverride,
  effectiveMemberPlan,
  effectiveMonthlyRegistrantLimit,
  manualPlanDto,
  memberManualPlan,
} from "./manualPlanEntitlements";
import { registerAiKnowledgeRoutes } from "./aiKnowledgeRoutes";
import { aiReplySettingsPatchSchema, aiReplySettingsSchema } from "@shared/aiAssistant";
import {
  ADDON_LOOKUP_KEY,
  ANNUAL_ADDON_LOOKUP_KEY,
  SUBSCRIPTION_PLANS,
  planLookupKey,
  type BillingInterval,
  getApprovedPriceIds,
  refreshSubscriptionEntitlement,
  type SubscriptionPlanKey,
} from "./subscriptionEntitlements";
import { PLAN_PRICING } from "@shared/pricing";
import { isPaidBillableSubscriptionInvoice, reconcileCurrentSubscriptionCredit } from "./subscriptionCreditGrants";
import { canRetainViewerWsAccess, canViewWebinar, webinarWatchEligibility } from "./webinarAccess";
import { appBaseUrl, emailVerificationMail, sendTransactionalMail } from "./mail";
import { createNumericVerificationCode, createRawToken, hashEmailVerificationCode, hashToken } from "./security";
import { postgresRateLimit } from "./rateLimit";
import { persistProductionError } from "./errorReporter";
import { verifyLiveCtaKey } from "./liveCtaKeys";
import {
  aggregateFunnelEvents,
  funnelDedupeKey,
  funnelEventInputSchema,
  safeRequestMetadata,
  sha256,
} from "./funnelAnalytics";
import {
  createCheckMacValue,
  decryptEcpayCredential,
  ecpayActionUrl,
  encryptEcpayCredential,
  merchantTradeNo,
  merchantTradeDate,
  validateEcpayCallbackIntegrity,
} from "./ecpay";
import { processVerifiedEcpayPayment } from "./offerPayments";
import { productSalesPageTargetUrl, registerProductCommerceRoutes } from "./productCommerce";
import { registerAiSalesPageRoutes } from "./aiSalesPage";
import { registerSalesScriptRoutes } from "./salesScriptRoutes";
import {
  signupConversion,
  validatePlatformAiPointsCheckout,
  validatePlatformSubscriptionCheckout,
} from "./platformConversions";
import { appendMemberOrderEvent, registerMemberOrderRoutes } from "./memberOrders";
import {
  createSalesPageSchema,
  salesPageCanPublish,
  salesPageSlugSchema,
  salesPageVersionSchema,
  updateSalesPageSchema,
  normalizeCheckoutSettings,
  validatePublishableBlocks,
} from "./salesPages";
import { buildLeadInsights, scoreLeadInsight } from "./leadInsights";
import { getBatchSessionRegistrationCounts, getSessionRegistrationCounts } from "./sessionRegistrationCounts";
import { registerCourseMarketplaceRoutes } from "./courseMarketplaceRoutes";
import type { SessionRegistrationCountsDto } from "@shared/sessionRegistrationCounts";
import { assertSafeWebhookUrl, deliverWebhook, WEBHOOK_LEASE_MS } from "./webhookDelivery";
import { externalThankYouForRegistration, registerExternalJourneyRoutes } from "./externalJourneys";
import { optionalRegistrationEnrichment } from "./externalJourneySafety";
import { externalJourneySettings } from "@shared/schema";
import { externalJourneySettingsSchema } from "@shared/externalJourneys";
import {
  isAcceptingWork,
  registerStopper,
  schedulerAttempt,
  schedulerFailure,
  schedulerSuccess,
  trackOperation,
} from "./operationsRuntime";
import {
  ensureNoCardTrial,
  getActiveNoCardTrial,
  getNoCardTrial,
  getNoCardTrialStatus,
  reserveTrialAiCall,
  refundTrialAiCall,
  completeTrialAiCall,
} from "./noCardTrial";

// ===== AI 點數計費常數 =====
const AI_POINTS_PER_REPLY = 1; // 每則 AI 回覆扣的點數
const AI_POINTS_PER_GENERATION = 5; // 每次 AI 一鍵生成（互動 / 電子報 / 貼文）扣的點數
const AI_WEBINAR_WIZARD_POINTS = 30;
const POINTS_PER_TWD = 1; // 1 元 = 1 點
const RECHARGE_MIN_TWD = 100; // 自訂金額最低消費
const RECHARGE_PACKAGES: Record<string, number> = { p300: 300, p1000: 1000, p3000: 3000 }; // 固定儲值包（元）
export const OFFER_CHECKOUT_RATE_LIMIT = { namespace: "offer-checkout", limit: 20, windowSeconds: 60 } as const;
/** New upgrades are immediately paid; no-card trials never create Stripe trials. */
export function immediatePaidSubscriptionData(input: {
  userId: string;
  planKey: string;
  billingInterval: string;
  addonWebinars: number;
}) {
  return {
    metadata: {
      userId: input.userId,
      planKey: input.planKey,
      billingInterval: input.billingInterval,
      addonWebinars: String(input.addonWebinars),
    },
  };
}
function createCheckoutStatusToken() {
  // 192-bit bearer capability; only its SHA-256 digest is persisted.
  return crypto.randomBytes(24).toString("base64url");
}
function checkoutStatusTokenHash(token: string) { return crypto.createHash("sha256").update(token).digest("hex"); }
function validCheckoutStatusToken(token: string) { return /^[A-Za-z0-9_-]{32}$/.test(token); }

declare module "express-session" {
  interface SessionData {
    userId?: string;
  }
}

const sessionConnections = new Map<string, WebSocket>();
const webinarSessions = new Map<string, Set<string>>();
const hostConnections = new Map<string, Set<WebSocket>>();
const sessionNicknames = new Map<string, string>();

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.session?.userId) {
    next();
  } else {
    res.status(401).json({ message: "Unauthorized" });
  }
}

function reportUnexpectedAuthDeliveryFailure(error: unknown, req: Request) {
  if (process.env.NODE_ENV === "production") {
    void persistProductionError(error, req, 500).catch(() => {
      // Reporting must never alter the generic auth response.
    });
  }
}

async function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const user = await storage.getUser(req.session.userId);
  if (!user || !user.isActive || !user.isSuperAdmin) {
    return res.status(403).json({ message: "Forbidden" });
  }
  next();
}

async function publicManagementRole(user: { id: string; isSuperAdmin: boolean }) {
  if (user.isSuperAdmin) return "super_admin";
  try {
    const [metadata] = await db.select({ managementRole: memberAdminMetadata.managementRole })
      .from(memberAdminMetadata).where(eq(memberAdminMetadata.userId, user.id)).limit(1);
    return metadata?.managementRole || "member";
  } catch (error: any) {
    // Supports a rolling deployment before the additive management migration
    // reaches every application node; it never grants access on failure.
    if (error?.code === "42P01") return "member";
    throw error;
  }
}

async function requireWebinarOwner(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const actor = await storage.getUser(req.session.userId);
  if (!actor?.isActive) return res.status(403).json({ message: "Account is suspended or unavailable" });
  const webinarId = req.params.id as string | undefined;
  if (webinarId) {
    const webinar = await storage.getWebinar(webinarId);
    if (!webinar) {
      return res.status(403).json({ message: "Forbidden" });
    }
    if (webinar.userId !== req.session.userId) {
      if (!actor.isSuperAdmin) return res.status(403).json({ message: "Forbidden" });
    }
  }
  next();
}

async function requirePublishedOrOwner(req: Request, res: Response, next: NextFunction) {
  const webinar = await storage.getWebinar(req.params.id as string);
  if (!webinar) return res.status(404).json({ message: "Webinar not found" });
  const requester = req.session?.userId ? await storage.getUser(req.session.userId) : undefined;
  if (!canViewWebinar(webinar, req.session?.userId, requester?.isSuperAdmin === true && requester.isActive)) {
    return res.status(404).json({ message: "Webinar not found" });
  }
  if (webinar.userId === req.session?.userId && !requester?.isActive) {
    return res.status(403).json({ message: "Account is suspended or unavailable" });
  }
  if (webinar.userId !== req.session?.userId && !(requester?.isSuperAdmin && requester.isActive)) {
    const owner = webinar.userId ? await storage.getUser(webinar.userId) : undefined;
    if (!await hasStoredPublicEntitlement(owner)) {
      return res.status(404).json({ message: "Webinar not found" });
    }
  }
  next();
}

function withSafeTrackingIds<T extends { metaPixelId?: string | null; gtmContainerId?: string | null }>(webinar: T): T {
  const metaPixelId = metaPixelIdSchema.safeParse(webinar.metaPixelId ?? null);
  const gtmContainerId = gtmContainerIdSchema.safeParse(webinar.gtmContainerId ?? null);
  return {
    ...webinar,
    metaPixelId: metaPixelId.success ? metaPixelId.data : null,
    gtmContainerId: gtmContainerId.success ? gtmContainerId.data : null,
  };
}

function publicWebinar<T extends { vimeoUrl?: string | null; videoAssetId?: string | null; aiSettings?: unknown }>(
  webinar: T,
): Omit<T, "vimeoUrl" | "videoAssetId" | "aiSettings"> {
  const {
    vimeoUrl: _vimeoUrl,
    videoAssetId: _videoAssetId,
    aiSettings: _aiSettings,
    ...safe
  } = withSafeTrackingIds(webinar as any);
  return safe;
}

async function verifiedWebinarVideo(
  userId: string,
  input: { videoProvider?: unknown; videoAssetId?: unknown; vimeoUrl?: unknown; videoDuration?: unknown },
  requireSource = false,
) {
  const provider = input.videoProvider === "bunny" ? "bunny" : "vimeo";
  if (provider === "bunny") {
    const parsedId = z.string().uuid().safeParse(input.videoAssetId);
    if (!parsedId.success) throw new Error("Bunny videoAssetId is required");
    const asset = await resolveReadyOwnedVideoAsset(userId, parsedId.data);
    if (!asset) throw new Error("videoAssetId must be a ready video owned by this member");
    return {
      videoProvider: "bunny" as const,
      videoAssetId: asset.id,
      vimeoUrl: "",
      videoDuration: asset.durationSeconds ?? 0,
    };
  }
  if (!input.vimeoUrl && !requireSource) {
    return {
      videoProvider: "vimeo" as const,
      videoAssetId: null,
      vimeoUrl: "",
      videoDuration: Number.isInteger(input.videoDuration) ? Number(input.videoDuration) : 0,
    };
  }
  const parsedUrl = z.string().url().refine(url => /^https:\/\/(?:www\.)?vimeo\.com\//i.test(url)).safeParse(input.vimeoUrl);
  if (!parsedUrl.success) throw new Error("A valid Vimeo URL is required");
  if (input.videoAssetId) throw new Error("Vimeo webinars cannot reference a Bunny asset");
  return {
    videoProvider: "vimeo" as const,
    videoAssetId: null,
    vimeoUrl: parsedUrl.data,
    videoDuration: Number.isInteger(input.videoDuration) ? Number(input.videoDuration) : 0,
  };
}

async function verifyOwnedLandingBunnyVideos(userId: string, blocks: unknown) {
  await verifyReferencedMediaUrls(blocks);
  if (!Array.isArray(blocks)) return;
  for (const block of blocks) {
    if (!block || typeof block !== "object" || (block as any).type !== "video" || (block as any).provider !== "bunny") continue;
    const asset = await resolveReadyOwnedVideoAsset(userId, (block as any).videoId);
    if (!asset) throw new Error("Landing page Bunny videos must be ready assets owned by this member");
  }
}

async function verifyReferencedMediaUrls(payload: unknown) {
  const serialized = JSON.stringify(payload ?? null);
  const invalid = await db.execute(sql`
    SELECT 1 FROM media_assets
     WHERE url IS NOT NULL
       AND position(url in ${serialized}) > 0
       AND (deleting_at IS NOT NULL OR status <> 'ready')
    UNION ALL
    SELECT 1 FROM deleted_media_urls
     WHERE position(url in ${serialized}) > 0
    LIMIT 1
  `);
  if (invalid.rows.length) throw new Error("Referenced media is unavailable or being deleted");
}

async function landingMediaPlayback(userId: string, blocks: unknown) {
  const playback: Record<string, ReturnType<BunnyMediaClient["playback"]>> = {};
  if (!Array.isArray(blocks)) return playback;
  const ids = Array.from(new Set(blocks.flatMap(block =>
    block && typeof block === "object" && (block as any).type === "video" && (block as any).provider === "bunny"
      ? [(block as any).videoId]
      : [])));
  const client = getBunnyMediaClient();
  for (const id of ids) {
    if (typeof id !== "string") continue;
    const asset = await resolveReadyOwnedVideoAsset(userId, id);
    if (asset?.providerId) playback[id] = client.playback(asset.providerId);
  }
  return playback;
}

async function hasStoredPublicEntitlement(user: Awaited<ReturnType<typeof storage.getUser>>): Promise<boolean> {
  if (!user || !user.isActive) return false;
  if (user.isSuperAdmin || user.subscriptionPlan === "enterprise") return true;
  if (["active", "trialing"].includes(user.subscriptionStatus)
    && (!user.planExpiresAt || new Date(user.planExpiresAt).getTime() > Date.now())) return true;
  if (await getActiveNoCardTrial(user.id)) return true;
  // Read live temporary-entitlement state for every public admission;
  // expiration/revocation never relies on cached user fields or alters Stripe.
  try {
    return Boolean(await activeMemberManualPlan(user.id) || await activePublishingOverride(user.id));
  } catch (error: any) {
    // During a rolling deployment an unmigrated node must fail closed rather
    // than accidentally admitting public traffic.
    if (error?.code === "42P01" || error?.code === "42703") return false;
    throw error;
  }
}

/**
 * Trial-only accounts may use the workbench and the deliberately-basic trial
 * commerce statistics, but not the advanced lead-scoring/funnel surfaces.
 * A retained, expired trial row remains a restriction only until a real paid
 * or active manual entitlement supersedes it.
 */
async function isAdvancedTrialOnlyAccount(userId: string): Promise<boolean> {
  const user = await storage.getUser(userId);
  if (!user) return true;
  const storedPaid = user.isSuperAdmin || user.subscriptionPlan === "enterprise" || (
    ["active", "trialing"].includes(user.subscriptionStatus)
    && (!user.planExpiresAt || user.planExpiresAt.getTime() > Date.now())
  );
  if (storedPaid) return false;
  if (await activeMemberManualPlan(userId) || await activePublishingOverride(userId)) return false;
  return Boolean(await getNoCardTrial(userId));
}

async function denyAdvancedTrialOnly(res: Response, ownerId: string | null): Promise<boolean> {
  if (!ownerId || !await isAdvancedTrialOnlyAccount(ownerId)) return false;
  res.status(403).json({
    message: "ADVANCED_ANALYTICS_REQUIRES_PAID_OR_MANUAL_ENTITLEMENT",
    code: "ADVANCED_ANALYTICS_REQUIRES_PAID_OR_MANUAL_ENTITLEMENT",
  });
  return true;
}

async function resolveOfferOwnerId(offer: { userId: string | null; webinarId: string | null }): Promise<string | null> {
  if (offer.userId) return offer.userId;
  if (!offer.webinarId) return null;
  const visibleWebinar = await storage.getWebinar(offer.webinarId);
  if (visibleWebinar?.userId) return visibleWebinar.userId;
  const [webinar] = await db.select({ userId: webinars.userId }).from(webinars)
    .where(eq(webinars.id, offer.webinarId)).limit(1);
  return webinar?.userId || null;
}

async function isWebinarAdministrator(webinarUserId: string | null, sessionUserId?: string): Promise<boolean> {
  if (!sessionUserId) return false;
  if (webinarUserId === sessionUserId) return true;
  return Boolean((await storage.getUser(sessionUserId))?.isSuperAdmin);
}

async function verifiedRegistrationCapability(req: Request) {
  const registration = await storage.getRegistration(req.params.id as string);
  const supplied = req.get("Authorization")?.replace(/^Bearer\s+/i, "") ||
    req.get("X-Watch-Token") || req.body?.watchToken || req.query.watchToken;
  const token = verifyWatchToken(supplied);
  return registration && token?.registrationId === registration.id && token.webinarId === registration.webinarId
    ? registration
    : undefined;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express,
  sessionMiddleware?: any,
  dependencies: {
    refreshEntitlement?: typeof refreshSubscriptionEntitlement;
    startScheduler?: () => void | { stop: () => Promise<void> };
    getStripe?: typeof getUncachableStripeClient;
    getApprovedPriceIds?: typeof getApprovedPriceIds;
  } = {},
): Promise<Server> {
  const refreshEntitlement = dependencies.refreshEntitlement ?? refreshSubscriptionEntitlement;
  const startScheduler = dependencies.startScheduler ?? startEmailScheduler;
  const getStripe = dependencies.getStripe ?? getUncachableStripeClient;
  const getApprovedPrices = dependencies.getApprovedPriceIds ?? getApprovedPriceIds;
  const revokeUserSessions = async (userId: string) => {
    // connect-pg-simple stores the signed-session payload in this table. Delete
    // every matching record so subsequent HTTP requests cannot reuse a cookie.
    await db.execute(sql`DELETE FROM "session" WHERE (sess::jsonb ->> 'userId') = ${userId}`);
    // Hosts are the only authenticated websocket role. Close their live sockets
    // immediately; future upgrades also re-check the suspended account.
    for (const [webinarId, sockets] of Array.from(hostConnections.entries())) {
      const webinar = await storage.getWebinar(webinarId);
      if (webinar?.userId !== userId) continue;
      for (const socket of Array.from(sockets)) {
        try { socket.close(1008, "Session revoked"); } catch { /* socket already closed */ }
      }
      hostConnections.delete(webinarId);
    }
  };
  // 發問通知信節流：每個直播間最短寄送間隔
  const questionNotifyThrottle = new Map<string, number>();
  const QUESTION_NOTIFY_COOLDOWN_MS = 60 * 1000;

  app.use(embedFramePolicy);
  app.use((req, res, next) => {
    const isPublicGetRoute =
      (req.method === 'GET' || req.method === 'OPTIONS') &&
       (req.path.match(/^\/api\/webinars\/[^/]+$/) || /^\/api\/webinars\/[^/]+\/landing-page$/.test(req.path) || /^\/api\/sales-pages\/[^/]+$/.test(req.path) || req.path === '/api/webinars') &&
      !req.path.includes('/stats/');
    const isPublicPostRoute =
      (req.method === 'POST' || req.method === 'OPTIONS') &&
      (req.path === '/api/registrations' || /^\/api\/webinars\/[^/]+\/funnel-events$/.test(req.path) ||
        /^\/api\/products\/[^/]+\/(?:checkout|events)$/.test(req.path));
    if (isPublicGetRoute || isPublicPostRoute) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
      }
    }
    next();
  });

  const authLimit = postgresRateLimit({ namespace: "auth", limit: 10, windowSeconds: 15 * 60 });
  const resetLimit = postgresRateLimit({ namespace: "reset", limit: 5, windowSeconds: 15 * 60 });
  const aiLimit = postgresRateLimit({ namespace: "ai", limit: 30, windowSeconds: 60 });
  const stripeLimit = postgresRateLimit({ namespace: "stripe-mutation", limit: 15, windowSeconds: 60 });
  const publicRegistrationLimit = postgresRateLimit({ namespace: "public-registration", limit: 10, windowSeconds: 60 });
  const offerCheckoutLimit = postgresRateLimit(OFFER_CHECKOUT_RATE_LIMIT);
  const supportLimit = postgresRateLimit({ namespace: "support", limit: 5, windowSeconds: 10 * 60 });
  const funnelEventLimit = postgresRateLimit({ namespace: "funnel-event", limit: 120, windowSeconds: 60 });
  const mediaLimit = postgresRateLimit({ namespace: "media", limit: 120, windowSeconds: 60 });
  app.use("/api/admin/login", authLimit);
  app.use("/api/admin/register", authLimit);
  app.use("/api/admin/forgot-password", resetLimit);
  app.use("/api/admin/reset-password", resetLimit);
  app.use("/api/admin/verify-email", resetLimit);
  app.use("/api/admin/resend-verification", resetLimit);
  app.use("/api/registrations", (req, res, next) =>
    req.method === "POST" && req.path === "/" ? publicRegistrationLimit(req, res, next) : next());
  app.use("/api/support", supportLimit);
  app.use("/api/webinars", (req, res, next) =>
    req.method === "POST" && /^\/[^/]+\/funnel-events$/.test(req.path) ? funnelEventLimit(req, res, next) : next());
  app.use("/api/webinars", (req, res, next) =>
    req.method === "POST" && /^\/[^/]+\/offer-checkout$/.test(req.path) ? offerCheckoutLimit(req, res, next) : next());
  app.use("/api/stripe", (req, res, next) => req.method === "POST" ? stripeLimit(req, res, next) : next());
  app.use("/api/webinars", (req, res, next) =>
    req.method === "POST" && (req.path.includes("/ai/") || req.path === "/ai-wizard") ? aiLimit(req, res, next) : next());
  app.use("/api/product-sales-pages", (req, res, next) =>
    req.method === "POST" && /^\/[^/]+\/ai-draft$/.test(req.path) ? aiLimit(req, res, next) : next());
  registerProductCommerceRoutes(
    app,
    requireAdmin,
    funnelEventLimit,
    offerCheckoutLimit,
    withMediaReferenceLock,
    verifyReferencedMediaUrls,
  );
  registerAiSalesPageRoutes(app, requireAdmin);
  registerMemberOrderRoutes(app);
  registerExternalJourneyRoutes(app, hasStoredPublicEntitlement);
  registerMcpRoutes(app, hasStoredPublicEntitlement);
  // registerBunnyMediaRoutes owns its final handlers. Intercept its DELETE
  // registration so the media lock wraps the returned handler Promise rather
  // than relying on an early app.use response-lifecycle middleware.
  const lockMediaDeletesApp = new Proxy(app, {
    get(target, property, receiver) {
      if (property !== "delete") return Reflect.get(target, property, receiver);
      return (routePath: string, ...handlers: any[]) => {
        const handler = handlers.pop();
        return target.delete(routePath, ...handlers, withMediaReferenceLock(handler));
      };
    },
  }) as Express;
  registerBunnyMediaRoutes(lockMediaDeletesApp, requireAdmin, mediaLimit);

  // ============ Image Upload ============
  const uploadsDir = process.env.UPLOADS_DIR
    ? path.resolve(process.env.UPLOADS_DIR)
    : path.join(process.cwd(), "client", "public", "uploads");
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  const uploadStorage = getUploadStorage(uploadsDir);

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_IMAGE_BYTES },
  });

  app.post("/api/upload", requireAdmin, mediaLimit, upload.single("file"), async (req: Request, res: Response) => {
    if (!req.file) {
      return res.status(400).json({ message: "未選擇檔案" });
    }
    try {
      const verified = await verifyImageUpload(req.file.buffer);
      const ownerId = req.session.userId!;
      if (!z.string().uuid().safeParse(ownerId).success) {
        return res.status(400).json({ message: "Invalid account identifier" });
      }
      const storageKey = `${ownerId}/images/${verified.filename}`;
      const client = getBunnyMediaClient();
      const [pending] = await db.insert(mediaAssets).values({
        userId: ownerId,
        kind: "image",
        provider: "bunny_storage",
        storageKey,
        name: req.file.originalname.slice(0, 200) || verified.filename,
        status: "uploading",
        sizeBytes: req.file.buffer.byteLength,
        contentType: verified.mime,
      }).returning();
      try {
        const url = await client.putImage(storageKey, req.file.buffer, verified.mime);
        await db.transaction(async tx => {
          await tx.insert(uploadedAssets).values({
            userId: ownerId,
            url,
            filename: verified.filename,
            storageBackend: "bunny_storage",
            storageKey,
            contentType: verified.mime,
            sizeBytes: req.file!.buffer.byteLength,
          });
          await tx.update(mediaAssets).set({ url, status: "ready", updatedAt: new Date() })
            .where(and(eq(mediaAssets.id, pending.id), eq(mediaAssets.userId, ownerId)));
        });
        return res.json({ url, filename: verified.filename });
      } catch (error) {
        await db.update(mediaAssets).set({
          status: "failed",
          errorCode: "IMAGE_UPLOAD_FAILED",
          updatedAt: new Date(),
        }).where(eq(mediaAssets.id, pending.id));
        await client.deleteImage(storageKey).catch(() => undefined);
        throw error;
      }
    } catch (error: any) {
      const invalidImage = typeof error?.message === "string" && error.message.startsWith("只允許");
      res.status(invalidImage ? 400 : 502).json({ message: invalidImage ? error.message : "圖片上傳失敗，請稍後再試" });
    }
  });

  app.delete("/api/upload", requireAdmin, mediaLimit, withMediaReferenceLock(async (req: Request, res: Response) => {
    const { url } = req.body;
    if (typeof url !== "string") return res.status(400).json({ message: "Invalid upload URL" });
    const [owned] = await db.select().from(uploadedAssets).where(and(
      eq(uploadedAssets.userId, req.session.userId!),
      eq(uploadedAssets.url, url),
    )).limit(1);
    // Legacy files without trustworthy ownership metadata are retained.
    if (!owned) return res.status(404).json({ message: "Upload not found" });
    const [linkedMedia] = await db.select().from(mediaAssets).where(and(
      eq(mediaAssets.userId, req.session.userId!),
      or(eq(mediaAssets.url, url), eq(mediaAssets.storageKey, owned.storageKey || "")),
    )).limit(1);
    if (linkedMedia) {
      try {
        const result = await deleteOwnedMediaAsset(req.session.userId!, linkedMedia.id, async () => {
          await uploadStorage.delete(uploadObjectKey(owned.filename));
          fs.rmSync(path.join(uploadsDir, owned.filename), { force: true });
        });
        if (result.outcome === "referenced") return res.status(409).json({ message: "Upload is referenced and cannot be deleted" });
        if (result.outcome === "not_found") return res.status(404).json({ message: "Upload not found" });
        return res.json({ success: true });
      } catch {
        return res.status(502).json({ message: "圖片刪除失敗，請稍後再試" });
      }
    }
    try {
      if (owned.storageBackend === "bunny_storage" && !owned.storageKey) {
        return res.status(409).json({ message: "Upload metadata is incomplete" });
      }
      const [fence] = await db.insert(mediaAssets).values({
        userId: req.session.userId!,
        kind: "image",
        provider: owned.storageBackend === "bunny_storage" ? "bunny_storage" : "legacy",
        storageKey: owned.storageKey,
        name: owned.filename,
        status: "ready",
        sizeBytes: owned.sizeBytes || 0,
        contentType: owned.contentType,
        url,
      }).returning();
      const result = await deleteOwnedMediaAsset(req.session.userId!, fence.id, async () => {
        await uploadStorage.delete(uploadObjectKey(owned.filename));
        fs.rmSync(path.join(uploadsDir, owned.filename), { force: true });
      });
      if (result.outcome === "referenced") return res.status(409).json({ message: "Upload is referenced and cannot be deleted" });
      if (result.outcome === "not_found") return res.status(404).json({ message: "Upload not found" });
    } catch {
      return res.status(502).json({ message: "圖片刪除失敗，請稍後再試" });
    }
    res.json({ success: true });
  }));

  // Explicit, owner-scoped copy migration. It is never run at startup and
  // deliberately leaves the original object in place. Existing /uploads URLs
  // continue to resolve through the backend discriminator below.
  app.post("/api/media/migrate-images", requireAdmin, async (req: Request, res: Response) => {
    const ownerId = req.session.userId!;
    if (!z.string().uuid().safeParse(ownerId).success) return res.status(400).json({ message: "Invalid account identifier" });
    const limit = Math.min(50, Math.max(1, Number(req.body?.limit) || 20));
    const candidates = await db.select().from(uploadedAssets).where(and(
      eq(uploadedAssets.userId, ownerId),
      inArray(uploadedAssets.storageBackend, ["legacy", "app_storage"]),
    )).limit(limit);
    let migrated = 0;
    const errors: Array<{ id: string; name: string; message: string }> = [];
    for (const asset of candidates) {
      if (!/^[A-Za-z0-9._-]+$/.test(asset.filename)) {
        errors.push({ id: asset.id, name: asset.filename, message: "檔名格式無效，已保留原始圖片" });
        continue;
      }
      let storageKey: string | undefined;
      const client = getBunnyMediaClient();
      try {
        const contents = await uploadStorage.get(uploadObjectKey(asset.filename));
        if (!contents) {
          errors.push({ id: asset.id, name: asset.filename, message: "找不到原始圖片，未進行遷移" });
          continue;
        }
        if (contents.byteLength > MAX_IMAGE_BYTES) {
          errors.push({ id: asset.id, name: asset.filename, message: "圖片超過大小限制，已保留原始圖片" });
          continue;
        }
        const verified = await verifyImageUpload(contents);
        storageKey = `${ownerId}/images/migrated-${asset.id}.${verified.extension}`;
        await client.putImage(storageKey, contents, verified.mime);
        const copied = await client.getImage(storageKey);
        if (!copied || copied.byteLength !== contents.byteLength ||
            !crypto.timingSafeEqual(crypto.createHash("sha256").update(copied).digest(), crypto.createHash("sha256").update(contents).digest())) {
          throw new Error("Copy verification failed");
        }
        await db.transaction(async tx => {
          await tx.update(uploadedAssets).set({
            storageBackend: "bunny_storage",
            storageKey,
            contentType: verified.mime,
            sizeBytes: contents.byteLength,
          }).where(and(eq(uploadedAssets.id, asset.id), eq(uploadedAssets.userId, ownerId)));
          await tx.insert(mediaAssets).values({
            userId: ownerId,
            kind: "image",
            provider: "bunny_storage",
            storageKey,
            name: asset.filename,
            status: "ready",
            sizeBytes: contents.byteLength,
            contentType: verified.mime,
            url: asset.url,
          });
        });
        migrated++;
      } catch {
        // Best-effort cleanup only; metadata remains on the old backend unless
        // the copy and byte verification both completed.
        if (storageKey) await client.deleteImage(storageKey).catch(() => undefined);
        errors.push({ id: asset.id, name: asset.filename, message: "圖片遷移或驗證失敗，已保留原始圖片" });
      }
    }
    res.json({ migrated, examined: candidates.length, errors });
  });

  // Uploaded objects are private; all reads go through this route so storage
  // credentials and provider URLs are never exposed to browsers.
  app.get("/uploads/:filename", async (req: Request, res: Response, next: NextFunction) => {
    const filename = req.params.filename;
    if (typeof filename !== "string" || !filename || filename.includes("/") || filename.includes("..")) return res.status(404).end();
    try {
      const [asset] = await db.select().from(uploadedAssets).where(eq(uploadedAssets.filename, filename)).limit(1);
      if (asset?.storageBackend === "bunny_storage" && asset.storageKey) {
        try {
          const migrated = await getBunnyMediaClient().getImage(asset.storageKey);
          if (!migrated) return res.status(404).end();
          res.setHeader("Content-Type", asset.contentType || safeUploadContentType(filename));
          res.setHeader("X-Content-Type-Options", "nosniff");
          res.setHeader("Cache-Control", "public, max-age=86400, immutable");
          return res.send(migrated);
        } catch {
          return res.status(502).json({ message: "圖片暫時無法讀取" });
        }
      }
      const contents = await uploadStorage.get(uploadObjectKey(filename));
      if (!contents) return next();
      res.setHeader("Content-Type", safeUploadContentType(filename));
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Disposition", "inline");
      res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
      res.setHeader("Cache-Control", "public, max-age=86400, immutable");
      return res.send(contents);
    } catch {
      // A legacy local asset may still exist even if App Storage cannot serve
      // this key; let the static fallback handle that migration case.
      return next();
    }
  });

  const serveStatic = (await import("express")).default.static;
  app.use("/uploads", serveStatic(uploadsDir, {
    maxAge: "1d",
    immutable: true,
    setHeaders: (res, filename) => {
      res.setHeader("Content-Type", safeUploadContentType(filename));
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Disposition", "inline");
      res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    },
  }));

  // WebSocket Server
  const wss = new WebSocketServer({ noServer: true });
  httpServer.on("upgrade", (request, socket, head) => {
    if (!isAcceptingWork()) {
      socket.destroy();
      return;
    }
    const pathname = new URL(request.url || "/", "http://localhost").pathname;
    if (pathname !== "/ws") return;
    wss.handleUpgrade(request, socket, head, (client) => {
      wss.emit("connection", client, request);
    });
  });
  registerStopper(() => new Promise<void>((resolve) => {
    for (const client of Array.from(wss.clients)) client.close(1001, "Server shutting down");
    const forceTimer = setTimeout(() => {
      for (const client of Array.from(wss.clients)) client.terminate();
    }, 2_000);
    forceTimer.unref();
    wss.close(() => {
      clearTimeout(forceTimer);
      resolve();
    });
  }));

  wss.on("connection", (ws, req) => {
    let currentWebinarId: string | null = null;
    let currentSessionId: string | null = null;
    let currentRegistrationId: string | null = null;
    let isHost = false;
    let sessionUserId: string | null = null;

    // Parse the express-session from the WS upgrade request cookie so we can
    // verify host ownership (prevents anyone from claiming host on any webinar).
    const sessionReady = new Promise<void>((resolve) => {
      if (!sessionMiddleware) return resolve();
      try {
        sessionMiddleware(req as any, {} as any, () => {
          sessionUserId = (req as any).session?.userId ?? null;
          resolve();
        });
      } catch {
        resolve();
      }
    });

    const revalidateWsAccess = async (): Promise<boolean> => {
      if (!currentWebinarId) return true;
      const currentWebinar = await storage.getWebinar(currentWebinarId);
      if (!currentWebinar) return false;
      if (isHost) {
        await sessionReady;
        const actor = sessionUserId ? await storage.getUser(sessionUserId) : undefined;
        return Boolean(actor?.isActive && (actor.isSuperAdmin || currentWebinar.userId === actor.id));
      }
      if (currentRegistrationId) {
        const owner = currentWebinar.userId ? await storage.getUser(currentWebinar.userId) : undefined;
        const registration = await storage.getRegistration(currentRegistrationId);
        const registrationEligible = Boolean(registration && registration.webinarId === currentWebinarId
          && webinarWatchEligibility(currentWebinar, registration).canWatch);
        return canRetainViewerWsAccess(
          currentWebinar.publishStatus,
          await hasStoredPublicEntitlement(owner),
          registrationEligible,
        );
      }
      await sessionReady;
      const actor = sessionUserId ? await storage.getUser(sessionUserId) : undefined;
      return Boolean(actor?.isActive && (actor.isSuperAdmin || currentWebinar.userId === actor.id));
    };

    const accessRevalidationTimer = setInterval(() => {
      void revalidateWsAccess().then((allowed) => {
        if (!allowed && ws.readyState === WebSocket.OPEN) ws.close(1008, "Webinar access expired");
      }).catch(() => {
        if (ws.readyState === WebSocket.OPEN) ws.close(1011, "Unable to verify webinar access");
      });
    }, 30_000);

    ws.on("message", async (data) => {
      try {
        const message = JSON.parse(data.toString());

        // Authorization is deliberately re-evaluated at every action so an
        // expired replay window, suspended owner, or revoked host session does
        // not retain powers until the socket disconnects.
        if (currentWebinarId && message.type !== "join" && message.type !== "joinAsHost") {
          const stillAuthorized = await revalidateWsAccess();
          if (!stillAuthorized) {
            ws.close(1008, "Webinar access expired");
            return;
          }
        }
        
        switch (message.type) {
          case "join": {
            // A socket already authorized as host must not be downgraded/retargeted
            // to a viewer context (prevents cross-tenant context switching).
            if (isHost || currentWebinarId) break;
            // Each viewer gets a unique session - complete isolation
            const { webinarId, sessionId: requestedSessionId, nickname, watchToken } = message.data;
            if (typeof webinarId !== "string" || typeof requestedSessionId !== "string") break;
            await sessionReady;
            const sessionActor = sessionUserId ? await storage.getUser(sessionUserId) : undefined;
            const requestedWebinar = await storage.getWebinar(webinarId);
            if (!requestedWebinar || !canViewWebinar(requestedWebinar, sessionUserId, sessionActor?.isSuperAdmin === true && sessionActor.isActive)) {
              ws.send(JSON.stringify({
                type: "error",
                data: { message: "Webinar not found or unavailable" },
              }));
              break;
            }
            const isPrivilegedViewer = Boolean(sessionActor?.isActive && (requestedWebinar.userId === sessionUserId || sessionActor.isSuperAdmin));
            let joinedRegistrationId: string | null = null;
            if (!isPrivilegedViewer) {
              const owner = requestedWebinar.userId ? await storage.getUser(requestedWebinar.userId) : undefined;
              if (!await hasStoredPublicEntitlement(owner)) {
                ws.send(JSON.stringify({ type: "error", data: { message: "Webinar not found or unavailable" } }));
                break;
              }
              const token = verifyWatchToken(watchToken);
              const registration = token && token.webinarId === webinarId
                ? await storage.getRegistration(token.registrationId)
                : undefined;
              if (!registration || registration.webinarId !== webinarId) {
                ws.send(JSON.stringify({ type: "error", data: { message: "Invalid watch token" } }));
                break;
              }
              if (!webinarWatchEligibility(requestedWebinar, registration).canWatch) {
                ws.send(JSON.stringify({ type: "error", data: { message: "This webinar is not currently available" } }));
                break;
              }
              joinedRegistrationId = registration.id;
            }
            const sessionId = viewerChatSessionId(webinarId, joinedRegistrationId
              ? `registration:${joinedRegistrationId}`
              : `preview:${sessionUserId}:${requestedSessionId}`);
            currentWebinarId = webinarId;
            currentSessionId = sessionId;
            currentRegistrationId = joinedRegistrationId;
            
            // Store session connection
            sessionConnections.set(sessionId, ws);
            
            // Track sessions per webinar
            if (!webinarSessions.has(webinarId)) {
              webinarSessions.set(webinarId, new Set());
            }
            webinarSessions.get(webinarId)!.add(sessionId);
            sessionNicknames.set(sessionId, (nickname && String(nickname).trim()) || "觀眾");
            
            // Send ONLY this session's messages (not other viewers')
            // For new sessions, this will be empty - they only see scheduled messages
            const sessionMessages = await storage.getChatMessagesBySession(webinarId, sessionId);
            const likeData = await storage.getLikes(webinarId);
            
            ws.send(JSON.stringify({
              type: "history",
              data: {
                messages: sessionMessages,
                likeCount: likeData?.count || 0
              }
            }));
            
            // Send session ID confirmation
            ws.send(JSON.stringify({
              type: "sessionConfirmed",
              data: { sessionId }
            }));
            
            // Update viewer count + presence list for hosts only
            broadcastToHosts(webinarId, {
              type: "viewerCount",
              data: { count: webinarSessions.get(webinarId)?.size || 0 }
            });
            broadcastPresence(webinarId);
            break;
          }
          
          case "joinAsHost": {
            const { webinarId } = message.data;

            // Verify the connection owns this webinar before granting host powers.
            await sessionReady;
            const ownedWebinar = await storage.getWebinar(webinarId);
            const hostActor = sessionUserId ? await storage.getUser(sessionUserId) : undefined;
            if (!sessionUserId || !ownedWebinar || !hostActor?.isActive ||
              (ownedWebinar.userId !== sessionUserId && !hostActor.isSuperAdmin)) {
              ws.send(JSON.stringify({
                type: "error",
                data: { message: "Unauthorized: not the webinar owner" }
              }));
              break;
            }

            currentWebinarId = webinarId;
            isHost = true;
            
            if (!hostConnections.has(webinarId)) {
              hostConnections.set(webinarId, new Set());
            }
            hostConnections.get(webinarId)!.add(ws);
            
            // Hosts see ALL messages from all sessions
            const allMessages = await storage.getChatMessagesByWebinar(webinarId);
            const likeData = await storage.getLikes(webinarId);
            ws.send(JSON.stringify({
              type: "history",
              data: {
                messages: allMessages,
                likeCount: likeData?.count || 0
              }
            }));
            
            // Send viewer count
            const viewerCount = webinarSessions.get(webinarId)?.size || 0;
            ws.send(JSON.stringify({
              type: "viewerCount",
              data: { count: viewerCount }
            }));
            ws.send(JSON.stringify({
              type: "viewerList",
              data: { online: buildPresence(webinarId) }
            }));
            break;
          }
          
          case "chat": {
            const { senderName, message: chatMessage } = message.data;

            // Always use server-bound connection identity; never trust client-supplied
            // webinarId/sessionId (prevents cross-webinar spoofing & AI cost abuse).
            const webinarId = currentWebinarId;
            if (!webinarId) break; // not joined yet

            // Host broadcast: requires server-verified host connection. Persist a single
            // canonical row (sessionId=null) and fan-out via WS to every connected viewer.
            // Per-session history reads include sessionId=null host rows, so reloads work.
            if (isHost) {
              const saved = await storage.createChatMessage({
                webinarId,
                sessionId: null,
                senderName,
                message: chatMessage,
                senderType: "host",
                isPrivate: false,
              });
              const sessions = webinarSessions.get(webinarId);
              if (sessions) {
                const payload = JSON.stringify({ type: "chat", data: saved });
                sessions.forEach(sid => {
                  const vws = sessionConnections.get(sid);
                  if (vws && vws.readyState === WebSocket.OPEN) {
                    vws.send(payload);
                  }
                });
              }
              broadcastToHosts(webinarId, { type: "chat", data: saved }, ws);
              break;
            }

            // Viewer: must have joined a session; session-tagged & always senderType "viewer"
            const sessionId = currentSessionId;
            if (!sessionId) break;
            const validatedChat = validateViewerChatContent(chatMessage);
            if (!validatedChat.ok) {
              ws.send(JSON.stringify({ type: "error", data: { message: validatedChat.message } }));
              break;
            }
            const viewerChatMessage = validatedChat.value;

            const savedMessage = await storage.createChatMessage({
              webinarId,
              sessionId,
              senderName,
              message: viewerChatMessage,
              senderType: "viewer",
              isPrivate: true
            });
            
            const viewerWs = sessionConnections.get(sessionId);
            if (viewerWs && viewerWs.readyState === WebSocket.OPEN && viewerWs !== ws) {
              viewerWs.send(JSON.stringify({
                type: "chat",
                data: savedMessage
              }));
            }
            
            broadcastToHosts(webinarId, {
              type: "chat",
              data: { ...savedMessage, sessionId }
            }, ws);

            // AI 助教：只對「看起來像問題」的觀眾訊息回覆（省成本）
            maybeAiReply(
              webinarId,
              sessionId,
              currentRegistrationId || sessionId,
              viewerChatMessage,
              ws,
            ).catch((err) =>
              console.error("AI reply failed:", err)
            );
            break;
          }
          
          case "hostReply": {
            if (!isHost || !currentWebinarId) break; // only verified host sockets may reply as host
            const { sessionId, senderName, message: chatMessage } = message.data;
            // Never trust a client-supplied webinarId; use the server-bound one.
            const webinarId = currentWebinarId;
            // The target session must belong to this host's webinar.
            if (!sessionId || !webinarSessions.get(webinarId)?.has(sessionId)) break;
            
            const savedMessage = await storage.createChatMessage({
              webinarId,
              sessionId,
              senderName,
              message: chatMessage,
              senderType: "host",
              isPrivate: true
            });
            
            const viewerWs = sessionConnections.get(sessionId);
            if (viewerWs && viewerWs.readyState === WebSocket.OPEN && viewerWs !== ws) {
              viewerWs.send(JSON.stringify({
                type: "chat",
                data: savedMessage
              }));
            }
            
            broadcastToHosts(webinarId, {
              type: "chat",
              data: { ...savedMessage, sessionId }
            }, ws);
            break;
          }
          
          case "scheduledMessage": {
            // Scheduled/fake user messages - only verified hosts may inject these.
            if (!isHost || !currentWebinarId) break;
            const webinarId = currentWebinarId;
            const { sessionId, senderName, message: chatMessage } = message.data;
            // Target session must belong to this host's webinar.
            if (!sessionId || !webinarSessions.get(webinarId)?.has(sessionId)) break;
            
            const viewerWs = sessionConnections.get(sessionId);
            if (viewerWs && viewerWs.readyState === WebSocket.OPEN) {
              viewerWs.send(JSON.stringify({
                type: "chat",
                data: {
                  id: `scheduled-${Date.now()}`,
                  webinarId,
                  senderName,
                  message: chatMessage,
                  senderType: "scheduled",
                  sentAt: new Date().toISOString()
                }
              }));
            }
            break;
          }
          
          case "like": {
            // Derive webinar/session from the server-bound connection state;
            // never trust client-supplied identifiers (prevents cross-tenant likes).
            if (!currentWebinarId || !currentSessionId) break;
            const webinarId = currentWebinarId;
            const sessionId = currentSessionId;
            const newCount = await storage.incrementLikes(webinarId);
            
            // Only send like update to this viewer
            const viewerWs = sessionConnections.get(sessionId);
            if (viewerWs && viewerWs.readyState === WebSocket.OPEN) {
              viewerWs.send(JSON.stringify({
                type: "like",
                data: { count: newCount }
              }));
            }
            
            broadcastToHosts(webinarId, {
              type: "like",
              data: { count: newCount }
            });
            break;
          }
          
          case "vote": {
            // Viewer must have joined; ignore client-supplied sessionId/webinarId.
            if (!currentWebinarId || !currentSessionId) break;
            const { pollId, optionIndex } = message.data;
            // The poll must belong to this viewer's webinar.
            const votePoll = await storage.getPoll(pollId);
            if (!votePoll || votePoll.webinarId !== currentWebinarId) break;
            
            await storage.createPollVote({
              pollId,
              participantId: currentSessionId,
              optionIndex
            });
            
            // Calculate and send results to this voter only
            const votes = await storage.getPollVotes(pollId);
            const results: Record<number, number> = {};
            votes.forEach(v => {
              results[v.optionIndex] = (results[v.optionIndex] || 0) + 1;
            });
            
            ws.send(JSON.stringify({
              type: "pollResults",
              data: { results }
            }));
            break;
          }
          
          case "liveCta": {
            // Host pushes a CTA button to ALL viewers immediately (no timecode wait)
            if (!isHost || !currentWebinarId) break;
            const { text, url, offerId, salesPageId, style, durationSec } = message.data || {};
            if (!text || [url, offerId, salesPageId].filter(Boolean).length !== 1) break;
            const webinar = await storage.getWebinar(currentWebinarId);
            if (!webinar?.userId) break;
            let safeUrl: string | null = null;
            let linkedOfferId: string | null = null;
            let linkedSalesPageId: string | null = null;
            if (salesPageId) {
              const [target] = await db.select({ page: offerSalesPages })
                .from(offerSalesPages)
                .innerJoin(webinarOffers, eq(offerSalesPages.offerId, webinarOffers.id))
                .where(and(
                  eq(offerSalesPages.id, String(salesPageId)),
                  sql`COALESCE(
                    ${offerSalesPages.userId},
                    ${webinarOffers.userId},
                    (SELECT owner_webinar.user_id FROM webinars owner_webinar WHERE owner_webinar.id = ${webinarOffers.webinarId})
                  ) = ${webinar?.userId || ""}`,
                  eq(offerSalesPages.status, "published"),
                  isNull(offerSalesPages.deletedAt),
                  sql`COALESCE(
                    ${webinarOffers.userId},
                    (SELECT owner_webinar.user_id FROM webinars owner_webinar WHERE owner_webinar.id = ${webinarOffers.webinarId})
                  ) = ${webinar?.userId || ""}`,
                  eq(webinarOffers.active, true),
                )).limit(1);
              if (!target) break;
              linkedSalesPageId = target.page.id;
            } else if (offerId) {
              const offer = await storage.getWebinarOffer(String(offerId));
              if (!offer?.active || await resolveOfferOwnerId(offer) !== webinar.userId) break;
              linkedOfferId = offer.id;
            } else {
              // Use the same server-side CTA URL policy as persisted CTAs.
              const parsedUrl = safeCtaUrlSchema.safeParse(String(url));
              if (!parsedUrl.success) break;
              safeUrl = parsedUrl.data;
            }
            const duration = Number.isFinite(Number(durationSec))
              ? Math.max(1, Math.min(2 * 60 * 60, Math.floor(Number(durationSec))))
              : 2 * 60 * 60;
            const expiresAt = new Date(Date.now() + duration * 1000);
            const parsed = insertCtaButtonSchema.safeParse({
              webinarId: currentWebinarId,
              text: String(text),
              url: safeUrl,
              offerId: linkedOfferId,
              salesPageId: linkedSalesPageId,
              startTime: 0,
              endTime: null,
              style: style || "primary",
            });
            if (!parsed.success) break;
            const liveCta = await storage.createLiveCtaButton(parsed.data, expiresAt);
            if (liveCta.salesPageId) {
              safeUrl = productSalesPageTargetUrl(currentWebinarId, liveCta.id);
            }
            const payload = {
              id: liveCta.id,
              ctaKey: liveCta.ctaKey,
              text: liveCta.text,
              url: safeUrl,
              salesPageId: liveCta.salesPageId,
              offerId: liveCta.offerId,
              style: liveCta.style || "primary",
              expiresAt: expiresAt.getTime(),
            };
            broadcastToAllSessions(currentWebinarId, { type: "liveCta", data: payload });
            broadcastToHosts(currentWebinarId, { type: "liveCta", data: payload });
            break;
          }

          case "liveTip": {
            // Host pushes a tip card to ALL viewers immediately
            if (!isHost || !currentWebinarId) break;
            const { title, content, durationSec } = message.data || {};
            if (!title && !content) break;
            const payload = {
              id: `live-tip-${Date.now()}`,
              title: String(title || ""),
              content: String(content || ""),
              duration: durationSec ? Number(durationSec) : 10,
            };
            broadcastToAllSessions(currentWebinarId, { type: "liveTip", data: payload });
            break;
          }

          case "liveChat": {
            // Host injects a fake-audience chat message visible to ALL viewers
            if (!isHost || !currentWebinarId) break;
            const { senderName, message: chatMessage } = message.data || {};
            if (!chatMessage) break;
            const payload = {
              id: `live-chat-${Date.now()}`,
              webinarId: currentWebinarId,
              senderName: String(senderName || "觀眾"),
              message: String(chatMessage),
              senderType: "scheduled",
              sentAt: new Date().toISOString(),
              isPrivate: false,
            };
            broadcastToAllSessions(currentWebinarId, { type: "chat", data: payload });
            broadcastToHosts(currentWebinarId, { type: "chat", data: payload });
            break;
          }

          case "triggerPoll": {
            // Host triggers poll for a specific session or all sessions
            if (!isHost || !currentWebinarId) break;
            const { pollId, sessionId } = message.data;
            const webinarId = currentWebinarId;
            const poll = await storage.getPoll(pollId);
            
            if (poll && poll.webinarId === webinarId) {
              if (sessionId) {
                // Target session must belong to this host's webinar.
                if (!webinarSessions.get(webinarId)?.has(sessionId)) break;
                // Send to specific session
                const viewerWs = sessionConnections.get(sessionId);
                if (viewerWs && viewerWs.readyState === WebSocket.OPEN) {
                  viewerWs.send(JSON.stringify({
                    type: "poll",
                    data: poll
                  }));
                }
              } else {
                // Send to all sessions in webinar
                broadcastToAllSessions(webinarId, {
                  type: "poll",
                  data: poll
                });
              }
            }
            break;
          }
        }
      } catch (error) {
        console.error("WebSocket message error:", error);
      }
    });

    ws.on("close", () => {
      clearInterval(accessRevalidationTimer);
      if (currentWebinarId) {
        if (isHost) {
          hostConnections.get(currentWebinarId)?.delete(ws);
        } else if (currentSessionId && sessionConnections.get(currentSessionId) === ws) {
          sessionConnections.delete(currentSessionId);
          webinarSessions.get(currentWebinarId)?.delete(currentSessionId);
          sessionNicknames.delete(currentSessionId);
          
          broadcastToHosts(currentWebinarId, {
            type: "viewerCount",
            data: { count: webinarSessions.get(currentWebinarId)?.size || 0 }
          });
          broadcastPresence(currentWebinarId);
        }
      }
    });
  });

  function broadcastToAllSessions(webinarId: string, message: any) {
    const sessions = webinarSessions.get(webinarId);
    if (sessions) {
      const data = JSON.stringify(message);
      sessions.forEach(sessionId => {
        const ws = sessionConnections.get(sessionId);
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      });
    }
  }

  function buildPresence(webinarId: string) {
    const sessions = webinarSessions.get(webinarId);
    const online: { sessionId: string; nickname: string }[] = [];
    if (sessions) {
      sessions.forEach((sid) => {
        online.push({ sessionId: sid, nickname: sessionNicknames.get(sid) || "觀眾" });
      });
    }
    return online;
  }

  function broadcastPresence(webinarId: string) {
    broadcastToHosts(webinarId, {
      type: "viewerList",
      data: { online: buildPresence(webinarId) }
    });
  }

  function broadcastToHosts(webinarId: string, message: any, excludeWs?: WebSocket) {
    const connections = hostConnections.get(webinarId);
    if (connections) {
      const data = JSON.stringify(message);
      connections.forEach(ws => {
        if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      });
    }
  }

  async function maybeAiReply(
    webinarId: string,
    sessionId: string,
    verifiedViewerId: string,
    viewerMessage: string,
    viewerSocket: WebSocket,
  ) {
    const webinar = await storage.getWebinar(webinarId);
    const ai = webinar?.aiSettings;
    if (!webinar || !ai?.enabled) return;
    if (!looksLikeQuestion(viewerMessage)) return;
    const admitted = await executeAdmittedAiReply(aiReplyAdmission, {
      ownerId: webinar.userId || `unowned:${webinarId}`,
      webinarId,
      viewerId: verifiedViewerId,
      question: viewerMessage,
    }, () => runAiReply({
        webinarId,
        sessionId,
        question: viewerMessage,
        kind: "live",
      }));
    if (!admitted.accepted) {
      if (viewerSocket.readyState === WebSocket.OPEN) {
        viewerSocket.send(JSON.stringify({ type: "error", data: { message: admitted.message } }));
      }
      return;
    }
    const result = admitted.value;
    if (result.chatMessage) {
      const viewerWs = sessionConnections.get(sessionId);
      if (viewerWs?.readyState === WebSocket.OPEN) {
        viewerWs.send(JSON.stringify({ type: "chat", data: result.chatMessage }));
      }
      broadcastToHosts(webinarId, { type: "chat", data: { ...result.chatMessage, sessionId } });
    }
  }

  // ============ Auth Routes ============
  app.post("/api/admin/clerk-bridge", async (req, res) => {
    const auth = getAuth(req);
    const clerkUserId = auth?.userId;
    if (!clerkUserId) {
      return res.status(401).json({ message: "Clerk authentication required" });
    }
    try {
      // Identity is sourced exclusively from Clerk's server API. Never accept
      // an email or user id from the browser.
      const clerkUser = await clerkClient.users.getUser(clerkUserId);
      const primaryEmail = clerkUser.emailAddresses.find(
        (entry) => entry.id === clerkUser.primaryEmailAddressId,
      );
      if (!primaryEmail || primaryEmail.verification?.status !== "verified") {
        return res.status(403).json({ message: "A verified primary email is required" });
      }
      const email = primaryEmail.emailAddress.trim().toLowerCase();
      const bridged = await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`clerk-email:${email}`}))`);
        const [byClerk] = await tx.select().from(users).where(eq(users.clerkUserId, clerkUserId)).limit(1);
        if (byClerk) {
          if (!byClerk.isActive) {
            throw Object.assign(new Error("Account is suspended or unavailable"), { code: "SUSPENDED" });
          }
          return { user: byClerk, created: false };
        }
        const matches = await tx.select().from(users).where(sql`lower(${users.email}) = ${email}`).limit(2);
        if (matches.length > 1) {
          throw Object.assign(new Error("Multiple local accounts use this email"), { code: "AMBIGUOUS_EMAIL" });
        }
        if (matches[0]) {
          if (!matches[0].isActive) {
            throw Object.assign(new Error("Account is suspended or unavailable"), { code: "SUSPENDED" });
          }
          // A local account can be linked to Clerk only once. A verified email
          // match must never be allowed to replace another Clerk identity.
          if (matches[0].clerkUserId && matches[0].clerkUserId !== clerkUserId) {
            throw Object.assign(new Error("Account is already linked to another identity"), { code: "CLERK_LINK_CONFLICT" });
          }
          const [user] = await tx.update(users).set({ clerkUserId }).where(and(
            eq(users.id, matches[0].id),
            isNull(users.clerkUserId),
          )).returning();
          if (!user) {
            throw Object.assign(new Error("Account identity link changed concurrently"), { code: "CLERK_LINK_CONFLICT" });
          }
          return { user, created: false };
        }
        const rawBase = (email.split("@")[0] || "member").toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "member";
        // Different email addresses can normalize to the same username base.
        // Serialize allocation for that base so the unique username check and
        // insert cannot race.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`clerk-username:${rawBase}`}))`);
        let username = rawBase;
        for (let suffix = 2; ; suffix += 1) {
          const [taken] = await tx.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1);
          if (!taken) break;
          username = `${rawBase.slice(0, 95 - String(suffix).length)}_${suffix}`;
        }
        const [user] = await tx.insert(users).values({
          username,
          email,
          clerkUserId,
          password: await bcrypt.hash(crypto.randomBytes(32).toString("base64url"), 12),
          emailVerificationRequired: false,
          emailVerifiedAt: new Date(),
        }).returning();
        return { user, created: true };
      });
      // Idempotent and eligibility-aware. Running this on every successful
      // bridge makes a transient failure retry-safe without granting a second
      // trial to paid, manually entitled, or previously trialed accounts.
      await ensureNoCardTrial(bridged.user.id);
      const managementRole = await publicManagementRole(bridged.user);
      req.session.regenerate((error) => {
        if (error) return res.status(500).json({ message: "登入失敗" });
        req.session.userId = bridged.user.id;
        req.session.save((saveError) => {
          if (saveError) return res.status(500).json({ message: "登入失敗" });
          res.json({
            success: true,
            created: bridged.created,
            user: {
              id: bridged.user.id,
              username: bridged.user.username,
              email: bridged.user.email,
              companyName: bridged.user.companyName,
              isSuperAdmin: bridged.user.isSuperAdmin,
              managementRole,
              canManage: managementRole !== "member",
            },
            ...(bridged.created ? { conversion: signupConversion(`platform_signup:${crypto.randomUUID()}`, bridged.user.id) } : {}),
          });
        });
      });
    } catch (error: any) {
      if (error?.code === "AMBIGUOUS_EMAIL") return res.status(409).json({ message: "Multiple local accounts use this email" });
      if (error?.code === "CLERK_LINK_CONFLICT") return res.status(409).json({ message: "Account is already linked to another identity" });
      if (error?.code === "SUSPENDED") return res.status(403).json({ message: "Account is suspended or unavailable" });
      reportUnexpectedAuthDeliveryFailure(error, req);
      return res.status(500).json({ message: "Unable to complete sign-in" });
    }
  });

  app.post("/api/admin/register", async (req, res) => {
    try {
      const { username, password, email, companyName } = req.body;
      if (
        typeof username !== "string" ||
        typeof password !== "string" ||
        typeof email !== "string" ||
        !username.trim() ||
        !email.trim() ||
        username.length > 100 ||
        email.length > 320 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      ) {
        return res.status(400).json({ message: "請填寫所有必填欄位" });
      }
      if (password.length < 6) {
        return res.status(400).json({ message: "密碼至少需要 6 個字元" });
      }
      const existing = await storage.getUserByUsername(username);
      if (existing) {
        return res.status(409).json({ message: "此帳號已被使用" });
      }
      // Do not disclose whether an email is already associated with an account.
      const normalizedEmail = email.trim().toLowerCase();
      const existingEmail = await storage.getUserByEmail(normalizedEmail);
      if (existingEmail) {
        return res.status(201).json({ success: true, verificationRequired: true });
      }
      const hashedPassword = await bcrypt.hash(password, 10);
      const user = await storage.createUser({
        username,
        password: hashedPassword,
        email: normalizedEmail,
        companyName: typeof companyName === "string" ? companyName.slice(0, 200) : "",
        emailVerificationRequired: true,
      });
      // This is a platform entitlement, not a Stripe trial. A duplicate-email
      // registration exits above before an account/trial can be created.
      await ensureNoCardTrial(user.id);
      const verificationCode = createNumericVerificationCode();
      await storage.createAuthToken(user.id, "email_verification", hashEmailVerificationCode(user.id, verificationCode), new Date(Date.now() + 10 * 60 * 1000));
      await sendTransactionalMail({
        to: user.email,
        ...emailVerificationMail(verificationCode),
      });
      res.status(201).json({
        success: true,
        verificationRequired: true,
        // This opaque marker is emitted only for a newly persisted platform
        // account. It contains no contact data and lets the browser dedupe the
        // conversion without treating login or duplicate-email responses as
        // new registrations.
        conversion: signupConversion(`platform_signup:${crypto.randomUUID()}`, user.id),
      });
    } catch (error: any) {
      reportUnexpectedAuthDeliveryFailure(error, req);
      res.status(500).json({ message: "註冊失敗" });
    }
  });

  app.post("/api/admin/login", async (req, res) => {
    const { username, password } = req.body;
    const user = await storage.getUserByUsername(username);
    if (!user) {
      return res.status(401).json({ message: "帳號或密碼錯誤" });
    }
    if (!user.isActive) {
      return res.status(403).json({ message: "帳號已停用，請聯繫客服" });
    }
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return res.status(401).json({ message: "帳號或密碼錯誤" });
    }
    if (user.emailVerificationRequired && !user.emailVerifiedAt) {
      return res.status(403).json({ message: "請先驗證電子郵件", code: "EMAIL_VERIFICATION_REQUIRED" });
    }
    const managementRole = await publicManagementRole(user);
    req.session.regenerate((error) => {
      if (error) return res.status(500).json({ message: "登入失敗" });
      req.session.userId = user.id;
      req.session.save((saveError) => {
        if (saveError) return res.status(500).json({ message: "登入失敗" });
        res.json({ success: true, user: { id: user.id, username: user.username, email: user.email, companyName: user.companyName, isSuperAdmin: user.isSuperAdmin,
          managementRole, canManage: managementRole !== "member" } });
      });
    });
  });

  app.post("/api/admin/verify-email", async (req, res) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ message: "驗證碼錯誤或已過期" });
    }
    const user = await storage.getUserByEmail(email);
    if (!user || !user.emailVerificationRequired || user.emailVerifiedAt) {
      return res.status(400).json({ message: "驗證碼錯誤或已過期" });
    }
    const consumed = await storage.consumeEmailVerificationCode(user.id, hashEmailVerificationCode(user.id, code));
    if (!consumed) return res.status(400).json({ message: "驗證碼錯誤或已過期" });
    res.json({ success: true });
  });

  app.post("/api/admin/resend-verification", async (req, res) => {
    const generic = { message: "If the account is eligible, a verification email will be sent." };
    try {
      const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
      const user = email ? await storage.getUserByEmail(email) : undefined;
      if (!user || !user.emailVerificationRequired || user.emailVerifiedAt) return res.json(generic);
      const latest = await storage.getLatestAuthTokenCreatedAt(user.id, "email_verification");
      if (latest && Date.now() - latest.getTime() < 60_000) return res.json(generic);
      const verificationCode = createNumericVerificationCode();
      await storage.createAuthToken(user.id, "email_verification", hashEmailVerificationCode(user.id, verificationCode), new Date(Date.now() + 10 * 60 * 1000));
      await sendTransactionalMail({
        to: user.email,
        ...emailVerificationMail(verificationCode),
      });
    } catch (error) {
      // Deliberately return the identical response to prevent account enumeration.
      reportUnexpectedAuthDeliveryFailure(error, req);
    }
    res.json(generic);
  });

  app.post("/api/admin/forgot-password", async (req, res) => {
    const generic = { message: "If an account exists, password reset instructions will be sent." };
    try {
      const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
      const user = email ? await storage.getUserByEmail(email) : undefined;
      if (!user) return res.json(generic);
      const latest = await storage.getLatestAuthTokenCreatedAt(user.id, "password_reset");
      if (latest && Date.now() - latest.getTime() < 60_000) return res.json(generic);
      const rawToken = createRawToken();
      await storage.createAuthToken(user.id, "password_reset", hashToken(rawToken), new Date(Date.now() + 15 * 60 * 1000));
      await sendTransactionalMail({
        to: user.email,
        subject: "Reset your password",
        html: `<p><a href="${appBaseUrl()}/reset-password?token=${encodeURIComponent(rawToken)}">Reset password</a>. This link expires in 15 minutes.</p>`,
      });
    } catch (error) {
      // Deliberately return the identical response to prevent account enumeration.
      reportUnexpectedAuthDeliveryFailure(error, req);
    }
    res.json(generic);
  });

  app.post("/api/admin/reset-password", async (req, res) => {
    const token = typeof req.body?.token === "string" ? req.body.token : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!token || token.length > 256 || password.length < 8 || password.length > 200) {
      return res.status(400).json({ message: "Invalid token or password" });
    }
    const changed = await storage.resetPasswordWithToken(hashToken(token), await bcrypt.hash(password, 12));
    if (!changed) return res.status(400).json({ message: "Invalid or expired token" });
    res.json({ success: true });
  });

  app.post("/api/admin/logout", (req, res) => {
    req.session.destroy(() => {
      res.json({ success: true });
    });
  });

  app.get("/api/admin/me", requireAdmin, async (req, res) => {
    const user = await storage.getUser(req.session.userId!);
    if (!user) return res.status(401).json({ message: "Unauthorized" });
    const managementRole = await publicManagementRole(user);
    res.json({ id: user.id, username: user.username, email: user.email, companyName: user.companyName, isSuperAdmin: user.isSuperAdmin,
      managementRole, canManage: managementRole !== "member" });
  });

  app.get("/api/admin/subscription", requireAdmin, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(401).json({ message: "Unauthorized" });
      const entitlement = await refreshEntitlement(user);
      const manual = await memberManualPlan(user.id);
      const override = await activePublishingOverride(user.id);
      const effective = composePublishingOverride(effectiveMemberPlan(entitlement, manual), override);
      const noCardTrial = await getActiveNoCardTrial(user.id);
      const accessActive = effective.active || Boolean(noCardTrial);
      const maxWebinars = Math.max(effective.maxWebinars, noCardTrial ? 1 : 0);
      const webinarCount = await storage.getWebinarCountByUser(user.id);
      const publishedCount = await storage.getPublishedWebinarCountByUser(user.id);
       res.json({
        // The original fields are effective access for the member dashboard.
        // `paid` remains Stripe-derived and is never synthesized from manual access.
        plan: effective.plan,
        amountUsd: entitlement.amountUsd,
        status: entitlement.status,
        active: accessActive,
        planStartedAt: effective.source === "manual" ? manual?.startsAt || null : entitlement.startedAt,
        planExpiresAt: effective.source === "manual" ? manual?.expiresAt || null : entitlement.currentPeriodEnd,
        cancelAtPeriodEnd: entitlement.cancelAtPeriodEnd,
        addonWebinars: entitlement.addonWebinars,
        maxWebinars,
        noCardTrialActive: Boolean(noCardTrial),
        effectivePlan: effective,
        manualPlan: manual ? manualPlanDto(manual) : null,
        publishingOverride: override ? {
          id: override.id, publishingSlots: override.publishingSlots,
          startsAt: override.startsAt.toISOString(), expiresAt: override.expiresAt.toISOString(),
        } : null,
        paid: {
          plan: entitlement.plan, status: entitlement.status, active: entitlement.active,
          planStartedAt: entitlement.startedAt, planExpiresAt: entitlement.currentPeriodEnd,
          cancelAtPeriodEnd: entitlement.cancelAtPeriodEnd, amountUsd: entitlement.amountUsd,
          stripeSubscriptionId: entitlement.stripeSubscriptionId,
        },
        webinarCount,
        publishedCount,
        isActive: user.isActive,
        isExpired: !accessActive && entitlement.plan !== "enterprise",
        isSuperAdmin: user.isSuperAdmin,
        managementRole: await publicManagementRole(user),
        canManage: (await publicManagementRole(user)) !== "member",
        hasStripeCustomer: Boolean(user.stripeCustomerId),
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ============ Super Admin Routes ============
  app.get("/api/super-admin/users", requireSuperAdmin, async (req, res) => {
    try {
      const allUsers = await storage.listAllUsers();
      const usersWithCount = await Promise.all(
        allUsers.map(async (u) => {
          const webinarCount = await storage.getWebinarCountByUser(u.id);
          const isExpired = u.planExpiresAt ? new Date(u.planExpiresAt) < new Date() : false;
          return {
            id: u.id,
            username: u.username,
            email: u.email,
            companyName: u.companyName,
            subscriptionPlan: u.subscriptionPlan,
            planExpiresAt: u.planExpiresAt,
            maxWebinars: u.maxWebinars,
            isActive: u.isActive,
            isSuperAdmin: u.isSuperAdmin,
            createdAt: u.createdAt,
            webinarCount,
            isExpired,
          };
        })
      );
      res.json(usersWithCount);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/super-admin/users/:userId", requireSuperAdmin, async (req, res) => {
    // This endpoint used to accept arbitrary plan, expiry and quota mutation
    // without an audit trail. It is intentionally retired rather than trying
    // to map unsafe legacy payloads onto the constrained management API.
    res.status(410).json({ message: "This legacy mutation is retired; use /api/management member actions" });
  });

  app.post("/api/support", requireAdmin, async (req, res) => {
    const parsed = insertSupportFeedbackSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid support submission" });
    const feedback = await storage.createSupportFeedback(req.session.userId!, parsed.data);
    res.status(201).json(feedback);
  });

  app.get("/api/super-admin/support", requireSuperAdmin, async (_req, res) => {
    res.json(await storage.listSupportFeedback());
  });

  app.patch("/api/super-admin/support/:id", requireSuperAdmin, async (req, res) => {
    res.status(410).json({ message: "This legacy mutation is retired; use /api/management/support/:id" });
  });

  // ============ Webinar Routes ============
  app.get("/api/webinars", async (req, res) => {
    if (req.session?.userId) {
      const webinars = await storage.getWebinarsByUser(req.session.userId);
      return res.json(webinars);
    }
    const webinars = await storage.getAllWebinars();
    const visible = await Promise.all(webinars
      .filter((webinar) => webinar.publishStatus === "published")
      .map(async (webinar) => {
        const owner = webinar.userId ? await storage.getUser(webinar.userId) : undefined;
        return await hasStoredPublicEntitlement(owner) ? publicWebinar(webinar) : null;
      }));
    res.json(visible.filter((webinar): webinar is NonNullable<typeof webinar> => webinar !== null));
  });

  app.get("/api/webinars/stats/summary", requireAdmin, async (req, res) => {
    try {
      const allWebinars = await storage.getWebinarsByUser(req.session.userId!);
      const sessionRegistrationCounts = await getBatchSessionRegistrationCounts(
        req.session.userId!,
        allWebinars.map(webinar => webinar.id),
      );
      const stats: Record<string, {
        registered: number;
        attended: number;
        engaged: number;
        onlineCount: number;
        sessionRegistrationCounts: SessionRegistrationCountsDto;
      }> = {};
      
      for (const webinar of allWebinars) {
        const regs = await storage.getRegistrationsByWebinar(webinar.id);
        const registered = regs.length;
        const attended = regs.filter(r => r.attended).length;
        
        const chatMsgs = await storage.getChatMessagesByWebinar(webinar.id);
        const viewerChatCount = chatMsgs.filter(m => m.senderType === "viewer").length;
        const likeData = await storage.getLikes(webinar.id);
        const likeCount = likeData?.count || 0;
        const interactionCount = viewerChatCount + likeCount;
        const engaged = attended > 0 ? Math.round((interactionCount / attended) * 100) : (registered > 0 ? Math.round((attended / registered) * 100) : 0);
        
        const onlineCount = webinarSessions.get(webinar.id)?.size || 0;
        
        stats[webinar.id] = {
          registered,
          attended,
          engaged,
          onlineCount,
          sessionRegistrationCounts: sessionRegistrationCounts[webinar.id] || { counts: [], totalRegistered: 0 },
        };
      }
      
      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/webinars/:id", requirePublishedOrOwner, async (req, res) => {
    const webinar = await storage.getWebinar(req.params.id as string);
    if (!webinar) {
      return res.status(404).json({ message: "Webinar not found" });
    }
    // Protect public/preview pages from legacy or manually inserted unsafe values.
    const isAdministrator = await isWebinarAdministrator(webinar.userId, req.session?.userId);
    res.json(isAdministrator ? withSafeTrackingIds(webinar) : publicWebinar(webinar));
  });

  app.post("/api/webinars", requireAdmin, withMediaReferenceLock(async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user || !user.isActive) {
        return res.status(403).json({ message: "帳號已停用" });
      }
      const validatedAiSettings = req.body?.aiSettings === undefined
        ? undefined
        : aiReplySettingsSchema.parse(req.body.aiSettings);
      const data = insertWebinarSchema.parse({
        ...req.body,
        ...(validatedAiSettings ? { aiSettings: validatedAiSettings } : {}),
        userId: req.session.userId,
        publishStatus: "draft",
      });
      await verifyReferencedMediaUrls(data);
      const video = await verifiedWebinarVideo(req.session.userId!, data);
      const webinar = await storage.createWebinar({ ...data, ...video });
      res.json(webinar);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }));

  const aiWebinarWizardSchema = z.object({
    title: z.string().trim().min(2).max(160),
    audience: z.string().trim().min(2).max(1000),
    goal: z.string().trim().min(2).max(2000),
    ctaText: z.string().trim().max(120).default(""),
    ctaUrl: z.union([z.literal(""), z.string().url().refine((url) => /^https?:\/\//i.test(url), "CTA 網址只允許 HTTP(S)")]).default(""),
    coverImage: z.union([z.literal(""), z.string().url().refine((url) => /^https:\/\//i.test(url), "Banner 網址只允許 HTTPS"), z.string().regex(/^\/uploads\/[A-Za-z0-9._-]+$/, "Banner 路徑無效")]).default(""),
    sourceContent: z.string().max(40000).default(""),
    vimeoUrl: z.union([z.literal(""), z.string().url().refine((url) => /^https:\/\/(?:www\.)?vimeo\.com\//i.test(url), "請輸入有效的 Vimeo 網址")]).default(""),
    videoProvider: z.enum(["vimeo", "bunny"]).default("vimeo"),
    videoAssetId: z.string().uuid().optional().nullable(),
    startTime: z.coerce.date(),
    videoDuration: z.coerce.number().int().min(0).max(86400).default(0),
  }).strict();

  app.post("/api/webinars/ai-wizard", requireAdmin, withMediaReferenceLock(async (req, res) => {
    const ownerId = req.session.userId!;
    const owner = await storage.getUser(ownerId);
    if (!owner) return res.status(401).json({ message: "Unauthorized" });
    if (!owner.isActive) return res.status(403).json({ message: "Account is suspended" });
    let input: z.infer<typeof aiWebinarWizardSchema>;
    let video: Awaited<ReturnType<typeof verifiedWebinarVideo>>;
    try {
      input = aiWebinarWizardSchema.parse(req.body);
      await verifyReferencedMediaUrls(input);
      video = await verifiedWebinarVideo(ownerId, input);
      input.videoDuration = video.videoDuration;
    } catch (error: any) {
      return res.status(400).json({ message: error.message });
    }

    const unlimited = owner.isSuperAdmin || owner.subscriptionPlan === "enterprise";
    // The wizard performs three provider requests. During an active no-card
    // trial each is ledgered independently, rather than reserving 30 paid
    // points or touching users.ai_points.
    const trialActive = !unlimited && owner.subscriptionPlan === "free"
      ? await getActiveNoCardTrial(ownerId)
      : null;
    const trialReservation = trialActive ? await reserveTrialAiCall(ownerId, 3) : null;
    const reservation = unlimited || trialActive ? null : await storage.reserveAiCredits(ownerId, AI_WEBINAR_WIZARD_POINTS);
    if (trialActive && !trialReservation) {
      return res.status(402).json({ message: `試用期 AI 額度已用完（共 ${NO_CARD_TRIAL_AI_CALL_LIMIT} 次）` });
    }
    if (!unlimited && !trialActive && !reservation) {
      return res.status(402).json({ message: `AI 點數不足，建立精靈需要 ${AI_WEBINAR_WIZARD_POINTS} 點` });
    }

    try {
      const knowledge = [
        `目標受眾：${input.audience}`,
        `商業目標：${input.goal}`,
        input.ctaText ? `主要行動：${input.ctaText}` : "",
        input.sourceContent,
      ].filter(Boolean).join("\n\n");
      const [plan, interactions, emails] = await Promise.all([
        generateWebinarPlan(input),
        generateInteractions(input.title, knowledge, input.videoDuration, `${input.goal}\n主要行動：${input.ctaText}`),
        generateEmailSequence(input.title, input.goal, knowledge),
      ]);
      if (!plan || !interactions || !emails?.length) {
        throw new Error("AI 無法完成所有內容，請補充更多資料後再試");
      }

      const webinarInput = insertWebinarSchema.parse({
        userId: ownerId,
        title: plan.title,
        description: plan.description,
        coverImage: input.coverImage || undefined,
        vimeoUrl: input.vimeoUrl,
        videoProvider: video.videoProvider,
        videoAssetId: video.videoAssetId,
        startTime: input.startTime,
        status: "scheduled",
        publishStatus: "draft",
        videoDuration: input.videoDuration,
        aiSettings: {
          enabled: false,
          teacherName: plan.teacherName,
          fallbackMessage: plan.fallbackMessage,
        },
        scarcitySettings: plan.scarcity,
        thankYouSettings: plan.thankYou,
        replaySettings: plan.replay,
      });

      const safeCtas = interactions.ctas.flatMap((cta) => {
        const candidate = cta.url === "#" ? input.ctaUrl : cta.url;
        const parsedUrl = safeCtaUrlSchema.safeParse(candidate);
        return parsedUrl.success ? [{ ...cta, url: parsedUrl.data }] : [];
      });
      const webinar = await storage.createAiWizardWebinar({
        webinar: webinarInput,
        reservationId: reservation?.reservationId,
        knowledge,
        interactions: { ...interactions, ctas: safeCtas },
        emails,
      });
      for (const reservationId of trialReservation?.reservationIds || []) {
        if (!await completeTrialAiCall(reservationId)) throw new Error("Trial AI reservation could not be completed");
      }

      res.json({
        success: true,
        webinar,
        pointsUsed: unlimited || trialReservation ? 0 : AI_WEBINAR_WIZARD_POINTS,
        remainingPoints: unlimited || trialReservation ? null : reservation!.remaining,
        trialCallsUsed: trialReservation?.reservationIds.length || 0,
        counts: {
          messages: interactions.messages.length,
          polls: interactions.polls.length,
          tips: interactions.tips.length,
          ctas: safeCtas.length,
          emails: emails.length,
        },
      });
    } catch (error: any) {
      let refunded = !reservation && !trialReservation;
      if (reservation) {
        try {
          await storage.refundAiCreditReservation(reservation.reservationId);
          refunded = true;
        } catch (refundError) {
          console.error("AI wizard credit refund failed:", refundError);
          void persistProductionError(refundError, req, 500).catch(() => {});
        }
      }
      if (trialReservation) {
        try {
          await Promise.all(trialReservation.reservationIds.map((reservationId) => refundTrialAiCall(reservationId)));
          refunded = true;
        } catch (refundError) {
          console.error("AI wizard trial reservation refund failed:", refundError);
          void persistProductionError(refundError, req, 500).catch(() => {});
        }
      }
      res.status(502).json({
        message: refunded
          ? "AI 建立失敗，請稍後再試（未扣點）"
          : "AI 建立失敗，點數退款處理異常，系統已通知客服協助處理",
      });
    }
  }));

  app.delete("/api/webinars/:id", requireWebinarOwner, async (req, res) => {
    await storage.deleteWebinar(req.params.id as string);
    res.json({ success: true });
  });

  app.patch("/api/webinars/:id", requireWebinarOwner, withMediaReferenceLock(async (req, res) => {
    try {
      const data = { ...req.body };
      delete data.publishStatus;
      delete data.userId;
      delete data.deletedAt;
      if (data.startTime && typeof data.startTime === "string") {
        data.startTime = new Date(data.startTime);
      }
      if ("metaPixelId" in data || "gtmContainerId" in data) {
        const tracking = webinarTrackingSettingsSchema.parse({
          ...("metaPixelId" in data ? { metaPixelId: data.metaPixelId } : {}),
          ...("gtmContainerId" in data ? { gtmContainerId: data.gtmContainerId } : {}),
        });
        if ("metaPixelId" in data) data.metaPixelId = tracking.metaPixelId;
        if ("gtmContainerId" in data) data.gtmContainerId = tracking.gtmContainerId;
      }
      const existing = await storage.getWebinar(req.params.id as string);
      if (!existing) return res.status(404).json({ message: "Webinar not found" });
      if ("aiSettings" in data) {
        const patch = aiReplySettingsPatchSchema.parse(data.aiSettings);
        // Storage applies this validated partial object with an atomic JSONB
        // merge, preserving newer fields when the legacy editor submits only
        // enabled/name/fallback settings.
        data.aiSettings = patch as any;
      }
      await verifyReferencedMediaUrls(data);
      if (["videoProvider", "videoAssetId", "vimeoUrl", "videoDuration"].some(key => key in data)) {
        if (!existing.userId) throw new Error("Webinar owner is missing");
        const video = await verifiedWebinarVideo(existing.userId, {
          videoProvider: data.videoProvider ?? existing.videoProvider,
          videoAssetId: data.videoAssetId === undefined ? existing.videoAssetId : data.videoAssetId,
          vimeoUrl: data.vimeoUrl === undefined ? existing.vimeoUrl : data.vimeoUrl,
          videoDuration: data.videoDuration === undefined ? existing.videoDuration : data.videoDuration,
        });
        Object.assign(data, video);
      }
      const webinar = await storage.updateWebinar(req.params.id as string, data);
      if (!webinar) {
        return res.status(404).json({ message: "Webinar not found" });
      }
      res.json(webinar);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }));

  // ============ Publish / Unpublish Webinar ============
  app.post("/api/webinars/:id/publish", requireWebinarOwner, withMediaReferenceLock(async (req, res) => {
    try {
      const targetWebinar = await storage.getWebinar(req.params.id as string);
      if (!targetWebinar?.userId) return res.status(404).json({ message: "Webinar not found" });
      const owner = await storage.getUser(targetWebinar.userId);
      if (!owner || !owner.isActive) {
        return res.status(403).json({ message: "帳號已停用" });
      }
      const entitlement = await refreshEntitlement(owner);
      const manual = await activeMemberManualPlan(owner.id);
      // Capacity-only overrides remain additive even when paid/manual access
      // is already active; the strongest active capacity always wins.
      const override = await activePublishingOverride(owner.id);
      const effective = composePublishingOverride(effectiveMemberPlan(entitlement, manual), override);
      const noCardTrial = await getActiveNoCardTrial(owner.id);
      if (!effective.active && !override && !noCardTrial) {
        return res.status(403).json({ message: "SUBSCRIPTION_REQUIRED", code: "SUBSCRIPTION_REQUIRED" });
      }
      await verifyReferencedMediaUrls(targetWebinar);
      await verifiedWebinarVideo(targetWebinar.userId, targetWebinar, true);
      // `publishingSlots` is an absolute temporary capacity, never a
      // replacement for an already-paid/grandfathered higher capacity.
      // An active no-card trial can publish exactly one webinar. The existing
      // atomic quota claim prevents concurrent requests from exceeding it.
      const maxPublished = Math.max(effective.maxWebinars, override?.publishingSlots || 0, noCardTrial ? 1 : 0);
      const publishResult = await storage.publishWebinarWithinLimit(owner.id, req.params.id as string);
      if (publishResult.entitlementExpired) {
        return res.status(403).json({ message: "SUBSCRIPTION_REQUIRED", code: "SUBSCRIPTION_REQUIRED" });
      }
      if (publishResult.limitExceeded) {
        return res.status(403).json({ message: "PUBLISH_LIMIT", code: "PUBLISH_LIMIT", maxPublished: publishResult.maxPublished ?? maxPublished });
      }
      const webinar = publishResult.webinar;
      if (!webinar) {
        return res.status(404).json({ message: "Webinar not found" });
      }
      res.json(webinar);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }));

  app.post("/api/webinars/:id/unpublish", requireWebinarOwner, async (req, res) => {
    try {
      const webinar = await storage.updateWebinar(req.params.id as string, { publishStatus: "draft" } as any);
      if (!webinar) {
        return res.status(404).json({ message: "Webinar not found" });
      }
      res.json(webinar);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // ============ Webinar registration landing page ============
  // The public endpoint is ID-based on purpose; no unsupported slug is exposed.
  app.get("/api/webinars/:id/landing-page/preview", requireWebinarOwner, async (req, res) => {
    const webinar = await storage.getWebinar(req.params.id as string);
    if (!webinar) return res.status(404).json({ message: "找不到說明會" });
    let page = await storage.getWebinarLandingPage(webinar.id);
    if (!page) {
      page = await storage.createWebinarLandingPage({
        webinarId: webinar.id, title: webinar.title,
        blocks: defaultWebinarLandingTemplate(webinar), brandSettings: DEFAULT_WEBINAR_LANDING_BRAND,
      });
    }
    try {
      res.json({
        webinar: withSafeTrackingIds(webinar),
        landingPage: page,
        mediaPlayback: await landingMediaPlayback(webinar.userId!, page.blocks),
        preview: true,
      });
    } catch {
      return res.status(503).json({ message: "Secure video playback is unavailable", code: "MEDIA_PLAYBACK_NOT_CONFIGURED" });
    }
  });

  app.get("/api/webinars/:id/landing-page", async (req, res) => {
    const webinar = await storage.getWebinar(req.params.id as string);
    if (!webinar) return res.status(404).json({ message: "找不到說明會" });
    const owner = webinar.userId ? await storage.getUser(webinar.userId) : undefined;
    if (!await hasStoredPublicEntitlement(owner)) return res.status(404).json({ message: "找不到說明會" });
    const page = await storage.getPublicWebinarLandingPage(webinar.id);
    if (!page) return res.status(404).json({ message: "說明會落地頁尚未發布" });
    try {
      res.json({
        webinar: publicWebinar(webinar),
        landingPage: page,
        mediaPlayback: await landingMediaPlayback(webinar.userId!, page.blocks),
        preview: false,
      });
    } catch {
      return res.status(503).json({ message: "Secure video playback is unavailable", code: "MEDIA_PLAYBACK_NOT_CONFIGURED" });
    }
  });

  app.post("/api/webinars/:id/landing-page", requireWebinarOwner, withMediaReferenceLock(async (req, res) => {
    try {
      const webinar = await storage.getWebinar(req.params.id as string);
      if (!webinar) return res.status(404).json({ message: "找不到說明會" });
      const existing = await storage.getWebinarLandingPage(webinar.id);
      if (existing) return res.json(existing);
      const input = req.body && Object.keys(req.body).length
        ? createWebinarLandingPageSchema.parse(req.body)
        : { title: webinar.title, blocks: defaultWebinarLandingTemplate(webinar), brandSettings: DEFAULT_WEBINAR_LANDING_BRAND };
      await verifyOwnedLandingBunnyVideos(webinar.userId!, input.blocks);
      res.status(201).json(await storage.createWebinarLandingPage({ webinarId: webinar.id, ...input }));
    } catch (error: any) {
      res.status(400).json({ message: error.message || "落地頁資料格式錯誤" });
    }
  }));

  app.patch("/api/webinars/:id/landing-page", requireWebinarOwner, withMediaReferenceLock(async (req, res) => {
    try {
      const input = updateWebinarLandingPageSchema.parse(req.body);
      const targetWebinar = await storage.getWebinar(req.params.id as string);
      if (!targetWebinar?.userId) return res.status(404).json({ message: "找不到說明會" });
      if (input.blocks) await verifyOwnedLandingBunnyVideos(targetWebinar.userId, input.blocks);
      const page = await storage.updateWebinarLandingPage(req.params.id as string, input.version, {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.blocks !== undefined ? { blocks: input.blocks } : {}),
        ...(input.brandSettings !== undefined ? { brandSettings: input.brandSettings } : {}),
      });
      if (!page) return res.status(409).json({ message: "版本已更新，請重新載入後再儲存", code: "VERSION_CONFLICT" });
      res.json(page);
    } catch (error: any) { res.status(400).json({ message: error.message || "落地頁資料格式錯誤" }); }
  }));

  app.post("/api/webinars/:id/landing-page/publish", requireWebinarOwner, withMediaReferenceLock(async (req, res) => {
    try {
      const input = webinarLandingVersionSchema.parse(req.body);
      const webinar = await storage.getWebinar(req.params.id as string);
      const page = await storage.getWebinarLandingPage(req.params.id as string);
      if (!webinar || !page) return res.status(404).json({ message: "找不到落地頁" });
      const allowed = webinarLandingPageCanPublish(webinar, page.blocks);
      if (!allowed.ok) return res.status(409).json({ message: allowed.message });
      await verifyOwnedLandingBunnyVideos(webinar.userId!, allowed.blocks);
      const published = await storage.setWebinarLandingPageStatus(webinar.id, input.version, "published");
      if (!published) return res.status(409).json({ message: "版本衝突或說明會已取消發布", code: "VERSION_CONFLICT" });
      res.json(published);
    } catch (error: any) { res.status(400).json({ message: error.message || "發布資料格式錯誤" }); }
  }));

  app.post("/api/webinars/:id/landing-page/unpublish", requireWebinarOwner, async (req, res) => {
    try {
      const input = webinarLandingVersionSchema.parse(req.body);
      const page = await storage.setWebinarLandingPageStatus(req.params.id as string, input.version, "draft");
      if (!page) return res.status(409).json({ message: "版本衝突，請重新載入後再試", code: "VERSION_CONFLICT" });
      res.json(page);
    } catch (error: any) { res.status(400).json({ message: error.message || "取消發布資料格式錯誤" }); }
  });

  app.get("/api/webinars/:id/landing-media/:assetId/playback", mediaLimit, async (req, res) => {
    const webinar = await storage.getWebinar(req.params.id as string);
    if (!webinar?.userId || webinar.publishStatus !== "published") return res.status(404).json({ message: "Media not found" });
    const owner = await storage.getUser(webinar.userId);
    if (!await hasStoredPublicEntitlement(owner)) return res.status(404).json({ message: "Media not found" });
    const page = await storage.getPublicWebinarLandingPage(webinar.id);
    const referenced = Array.isArray(page?.blocks) && page.blocks.some(block =>
      block.type === "video" && block.provider === "bunny" && block.videoId === req.params.assetId);
    if (!referenced) return res.status(404).json({ message: "Media not found" });
    const asset = await resolveReadyOwnedVideoAsset(webinar.userId, req.params.assetId as string);
    if (!asset?.providerId) return res.status(404).json({ message: "Media not found" });
    try {
      return res.json(getBunnyMediaClient().playback(asset.providerId));
    } catch {
      return res.status(503).json({ message: "Secure video playback is unavailable", code: "MEDIA_PLAYBACK_NOT_CONFIGURED" });
    }
  });

  // ============ No-card trial ============
  app.get("/api/trial", requireAdmin, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(401).json({ message: "Unauthorized" });
      return res.json(await getNoCardTrialStatus(user.id));
    } catch (error: any) {
      return res.status(500).json({ message: error.message || "Unable to read trial status" });
    }
  });

  // Existing free accounts must opt in explicitly. New accounts are started
  // during registration, and the server re-checks all historical eligibility.
  app.post("/api/trial/activate", requireAdmin, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(401).json({ message: "Unauthorized" });
      const trial = await ensureNoCardTrial(user.id);
      if (!trial) {
        return res.status(409).json({
          message: "NO_CARD_TRIAL_INELIGIBLE",
          code: "NO_CARD_TRIAL_INELIGIBLE",
          trial: await getNoCardTrialStatus(user.id),
        });
      }
      return res.status(201).json(await getNoCardTrialStatus(user.id));
    } catch (error: any) {
      return res.status(500).json({ message: error.message || "Unable to activate trial" });
    }
  });

  // ============ Stripe Routes ============
  app.get("/api/stripe/publishable-key", async (_req, res) => {
    try {
      const key = await getStripePublishableKey();
      res.json({ publishableKey: key });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/stripe/config", async (_req, res) => {
    const planDefinitions = [
      { key: "starter", amountUsd: PLAN_PRICING.starter.monthlyUSD, annualAmountUsd: PLAN_PRICING.starter.annualUSD, includedWebinars: 1, monthlyRegistrants: 1_000, monthlyAiPoints: 100, trialDays: 0 },
      { key: "growth", amountUsd: PLAN_PRICING.growth.monthlyUSD, annualAmountUsd: PLAN_PRICING.growth.annualUSD, includedWebinars: 5, monthlyRegistrants: 3_000, monthlyAiPoints: 200, trialDays: 0 },
      { key: "scale", amountUsd: PLAN_PRICING.scale.monthlyUSD, annualAmountUsd: PLAN_PRICING.scale.annualUSD, includedWebinars: 15, monthlyRegistrants: 5_000, monthlyAiPoints: 300, trialDays: 0 },
    ];
    try {
      const key = await getStripePublishableKey();
      const { byLookupKey } = await getApprovedPriceIds();
      const plans = planDefinitions.map((plan) => ({
        ...plan,
        available: byLookupKey.has(SUBSCRIPTION_PLANS[plan.key as SubscriptionPlanKey].lookupKey),
        annualAvailable: byLookupKey.has(SUBSCRIPTION_PLANS[plan.key as SubscriptionPlanKey].annualLookupKey),
      }));
      const catalogReady = [
        ...Object.values(SUBSCRIPTION_PLANS).flatMap((plan) => [plan.lookupKey, plan.annualLookupKey]),
        ADDON_LOOKUP_KEY,
        ANNUAL_ADDON_LOOKUP_KEY,
      ].every((lookupKey) => byLookupKey.has(lookupKey));
      res.json({
        publishableKey: key,
        billingAvailable: true,
        catalogReady,
        plans,
        addonAmountUsd: 20,
        annualAddonAmountUsd: 204,
      });
    } catch (error: any) {
      console.error("Stripe configuration unavailable:", error?.message || error);
      res.json({
        publishableKey: "",
        billingAvailable: false,
        catalogReady: false,
        plans: planDefinitions.map((plan) => ({ ...plan, available: false, annualAvailable: false })),
        addonAmountUsd: 20,
        annualAddonAmountUsd: 204,
      });
    }
  });

  app.post("/api/stripe/checkout", requireAdmin, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(401).json({ message: "Unauthorized" });
      if (user.stripeCustomerId) {
        const current = await refreshSubscriptionEntitlement(user);
        if (current.active) {
          return res.status(409).json({ message: "ACTIVE_SUBSCRIPTION_EXISTS", code: "ACTIVE_SUBSCRIPTION_EXISTS" });
        }
      }

      const stripe = await getUncachableStripeClient();

      const planKey = req.body.planKey as SubscriptionPlanKey;
      const billingInterval: BillingInterval = req.body.billingInterval === "year" ? "year" : "month";
      const addonWebinars = Number(req.body.addonWebinars || 0);
      if (!(planKey in SUBSCRIPTION_PLANS)) return res.status(400).json({ message: "Invalid plan" });
      if (!Number.isInteger(addonWebinars) || addonWebinars < 0 || addonWebinars > 50) {
        return res.status(400).json({ message: "Invalid add-on quantity" });
      }
      const { byLookupKey } = await getApprovedPriceIds();
      const basePriceId = byLookupKey.get(planLookupKey(planKey, billingInterval));
      const addonPriceId = byLookupKey.get(billingInterval === "year" ? ANNUAL_ADDON_LOOKUP_KEY : ADDON_LOOKUP_KEY);
      if (!basePriceId || (addonWebinars > 0 && !addonPriceId)) {
        return res.status(503).json({ message: "Subscription catalog is not ready" });
      }

      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const session = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`subscription-checkout:${user.id}`}))`);
        const [lockedUser] = await tx.select().from(users).where(eq(users.id, user.id)).for("update");
        if (!lockedUser) throw new Error("Unauthorized");

        let customerId = lockedUser.stripeCustomerId;
        if (!customerId) {
          const customer = await stripe.customers.create({
            email: lockedUser.email || undefined,
            metadata: { userId: lockedUser.id, username: lockedUser.username },
          }, {
            idempotencyKey: `icta-customer-${lockedUser.id}`,
          });
          customerId = customer.id;
          await tx.update(users).set({ stripeCustomerId: customerId }).where(eq(users.id, lockedUser.id));
        }

        const previousSubscriptions = await stripe.subscriptions.list({
          customer: customerId,
          status: "all",
          limit: 100,
        });
        if (previousSubscriptions.data.some((subscription) => ["active", "trialing"].includes(subscription.status))) {
          throw new Error("ACTIVE_SUBSCRIPTION_EXISTS");
        }

        const openSessions = await stripe.checkout.sessions.list({
          customer: customerId,
          status: "open",
          limit: 100,
        });
        for (const openSession of openSessions.data) {
          if (openSession.metadata?.kind !== "subscription" || openSession.metadata?.userId !== lockedUser.id) continue;
          const sameSelection = openSession.metadata.planKey === planKey
            && openSession.metadata.billingInterval === billingInterval
            && openSession.metadata.addonWebinars === String(addonWebinars);
          if (sameSelection && openSession.url) {
            await tx.update(users)
              .set({ stripeSubscriptionCheckoutSessionId: openSession.id })
              .where(eq(users.id, lockedUser.id));
            return openSession;
          }
          await stripe.checkout.sessions.expire(openSession.id);
        }

        const created = await stripe.checkout.sessions.create({
          customer: customerId,
          payment_method_types: ["card"],
          line_items: [
            { price: basePriceId, quantity: 1 },
            ...(addonWebinars > 0 ? [{ price: addonPriceId!, quantity: addonWebinars }] : []),
          ],
          mode: "subscription",
          client_reference_id: lockedUser.id,
          metadata: {
            kind: "subscription",
            userId: lockedUser.id,
            planKey,
            billingInterval,
            addonWebinars: String(addonWebinars),
          },
          subscription_data: immediatePaidSubscriptionData({
            userId: lockedUser.id,
            planKey,
            billingInterval,
            addonWebinars,
          }),
          success_url: `${baseUrl}/admin/dashboard?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${baseUrl}/admin/dashboard?checkout=cancel`,
        });
        await tx.update(users).set({
          stripeSubscriptionCheckoutSessionId: created.id,
        }).where(eq(users.id, lockedUser.id));
        return created;
      });

      res.json({ url: session.url });
    } catch (error: any) {
      if (error?.message === "ACTIVE_SUBSCRIPTION_EXISTS") {
        return res.status(409).json({ message: "ACTIVE_SUBSCRIPTION_EXISTS", code: "ACTIVE_SUBSCRIPTION_EXISTS" });
      }
      res.status(500).json({ message: error.message });
    }
  });

  /**
   * Return an authoritative browser conversion only after the app Stripe
   * client has verified ownership, payment status, and the approved catalog.
   * This endpoint never fulfills a subscription; the existing webhook and
   * entitlement reconciliation remain responsible for billing state.
   */
  app.post("/api/stripe/confirm-platform-checkout", requireAdmin, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(401).json({ message: "Unauthorized" });
      const sessionId = typeof req.body?.sessionId === "string" ? req.body.sessionId.trim() : "";
      if (!sessionId || sessionId.length > 255) {
        return res.status(400).json({ message: "缺少 sessionId" });
      }

      const stripe = await getStripe();
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const metadata = session.metadata || {};
      const planKey = metadata.planKey as SubscriptionPlanKey;
      const billingInterval = metadata.billingInterval === "year" ? "year" : metadata.billingInterval === "month" ? "month" : "";
      const addonWebinars = Number(metadata.addonWebinars);
      if (!(planKey in SUBSCRIPTION_PLANS) || !billingInterval || !Number.isInteger(addonWebinars)) {
        return res.status(403).json({ message: "無效的付款資訊" });
      }

      const { byLookupKey } = await getApprovedPrices();
      const basePriceId = byLookupKey.get(planLookupKey(planKey, billingInterval));
      const addonPriceId = byLookupKey.get(
        billingInterval === "year" ? ANNUAL_ADDON_LOOKUP_KEY : ADDON_LOOKUP_KEY,
      );
      if (!basePriceId || (addonWebinars > 0 && !addonPriceId)) {
        return res.status(503).json({ message: "Subscription catalog is not ready" });
      }

      const listedItems = await stripe.checkout.sessions.listLineItems(sessionId, { limit: 100 });
      const validation = validatePlatformSubscriptionCheckout({
        session,
        lineItems: listedItems.data,
        userId: user.id,
        stripeCustomerId: user.stripeCustomerId,
        planKey,
        billingInterval,
        addonWebinars,
        basePriceId,
        addonPriceId,
      });
      if (validation.status !== "paid" || !validation.conversion) {
        return res.json({ status: validation.status });
      }
      return res.json({
        status: "paid",
        conversion: validation.conversion,
      });
    } catch (error: any) {
      if (error?.message === "INVALID_PLATFORM_CHECKOUT") {
        return res.status(403).json({ message: "無效的付款資訊" });
      }
      console.error("Platform checkout confirmation failed:", error?.message || error);
      return res.status(502).json({ message: "付款狀態暫時無法確認" });
    }
  });

  app.post("/api/stripe/portal", requireAdmin, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user || !user.stripeCustomerId) {
        return res.status(400).json({ message: "No Stripe customer found" });
      }

      const stripe = await getUncachableStripeClient();
      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const portalSession = await stripe.billingPortal.sessions.create({
        customer: user.stripeCustomerId,
        return_url: `${baseUrl}/admin/dashboard`,
      });

      res.json({ url: portalSession.url });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/stripe/end-trial", requireAdmin, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user || !user.stripeCustomerId) {
        return res.status(400).json({ message: "No Stripe customer found" });
      }

      const entitlement = await refreshSubscriptionEntitlement(user);
      if (!entitlement.stripeSubscriptionId || entitlement.status !== "trialing") {
        return res.status(409).json({ message: "SUBSCRIPTION_NOT_TRIALING", code: "SUBSCRIPTION_NOT_TRIALING" });
      }

      const stripe = await getUncachableStripeClient();
      const subscription = await stripe.subscriptions.retrieve(entitlement.stripeSubscriptionId);
      const customerId = typeof subscription.customer === "string"
        ? subscription.customer
        : subscription.customer.id;
      if (customerId !== user.stripeCustomerId || subscription.status !== "trialing") {
        return res.status(409).json({ message: "SUBSCRIPTION_NOT_TRIALING", code: "SUBSCRIPTION_NOT_TRIALING" });
      }

      const updated = await stripe.subscriptions.update(subscription.id, {
        trial_end: "now",
        expand: ["latest_invoice"],
      }, {
        idempotencyKey: `end-trial-now:${subscription.id}`,
      });

      const latestInvoice = typeof updated.latest_invoice === "string"
        ? await stripe.invoices.retrieve(updated.latest_invoice)
        : updated.latest_invoice;
      const paid = Boolean(latestInvoice && isPaidBillableSubscriptionInvoice(latestInvoice));

      if (paid) {
        try {
          await reconcileCurrentSubscriptionCredit(user.id, updated.id);
        } catch (reconcileError) {
          console.error("Early trial payment succeeded but AI credit reconciliation is pending:", reconcileError);
        }
      }

      res.json({
        status: updated.status,
        paid,
        paymentUrl: paid ? null : latestInvoice?.hosted_invoice_url || null,
      });
    } catch (error: any) {
      console.error("Failed to end Stripe trial:", error);
      res.status(502).json({ message: "無法完成提前付款，請確認付款方式後再試一次。" });
    }
  });

  app.get("/api/stripe/subscription-status", requireAdmin, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(401).json({ message: "Unauthorized" });

      const entitlement = await refreshSubscriptionEntitlement(user);
      if (entitlement.active && entitlement.stripeSubscriptionId && entitlement.plan !== "enterprise" && entitlement.plan !== "legacy") {
        await reconcileCurrentSubscriptionCredit(user.id, entitlement.stripeSubscriptionId);
      }
      return res.json(entitlement);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ============ AI 點數計費 ============
  // 取得目前廠商的 AI 點數餘額
  app.get("/api/ai-points", requireAdmin, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(401).json({ message: "Unauthorized" });
      const unlimited = user.isSuperAdmin || user.subscriptionPlan === "enterprise";
      if (!unlimited && user.stripeCustomerId) {
        try {
          const entitlement = await refreshSubscriptionEntitlement(user);
          if (entitlement.active && entitlement.stripeSubscriptionId && entitlement.plan !== "legacy") {
            await reconcileCurrentSubscriptionCredit(user.id, entitlement.stripeSubscriptionId);
          }
        } catch (error) {
          console.warn("Could not reconcile current subscription AI credits:", error);
        }
      }
      const summary = await storage.getAiCreditSummary(user.id);
      const planMonthlyGift = user.subscriptionPlan in SUBSCRIPTION_PLANS
        ? SUBSCRIPTION_PLANS[user.subscriptionPlan as SubscriptionPlanKey].monthlyAiPoints
        : 0;
      res.json({
        ...summary,
        unlimited,
        planMonthlyGift,
        pointsPerReply: AI_POINTS_PER_REPLY,
        pointsPerTwd: POINTS_PER_TWD,
        minTwd: RECHARGE_MIN_TWD,
        packages: Object.entries(RECHARGE_PACKAGES).map(([id, twd]) => ({ id, twd, points: twd * POINTS_PER_TWD })),
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // 建立 AI 點數充值 Checkout（一次性付款）
  app.post("/api/stripe/recharge-checkout", requireAdmin, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(401).json({ message: "Unauthorized" });

      // 計算金額（元）：固定包或自訂金額
      let amountTwd: number;
      const { packageId, amount } = req.body || {};
      if (packageId) {
        if (!RECHARGE_PACKAGES[packageId]) {
          return res.status(400).json({ message: "無效的儲值包" });
        }
        amountTwd = RECHARGE_PACKAGES[packageId];
      } else {
        amountTwd = Math.floor(Number(amount));
        if (!Number.isFinite(amountTwd) || amountTwd < RECHARGE_MIN_TWD) {
          return res.status(400).json({ message: `自訂金額最低為 ${RECHARGE_MIN_TWD} 元` });
        }
      }
      const points = amountTwd * POINTS_PER_TWD;

      const stripe = await getUncachableStripeClient();
      let customerId = user.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: user.email || undefined,
          metadata: { userId: user.id, username: user.username },
        });
        await storage.updateUser(user.id, { stripeCustomerId: customer.id } as any);
        customerId = customer.id;
      }

      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        payment_method_types: ["card"],
        mode: "payment",
        line_items: [{
          price_data: {
            currency: "twd",
            product_data: { name: `AI 回覆點數 ${points} 點` },
            unit_amount: amountTwd * 100,
          },
          quantity: 1,
        }],
        metadata: { userId: user.id, points: String(points), amountTwd: String(amountTwd), kind: "ai_points" },
        success_url: `${baseUrl}/admin/dashboard?recharge=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/admin/dashboard?recharge=cancel`,
      });

      res.json({ url: session.url });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // 付款完成後由前端帶 session_id 回來確認入點（冪等）
  app.post("/api/stripe/confirm-recharge", requireAdmin, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(401).json({ message: "Unauthorized" });
      const { sessionId } = req.body || {};
      if (!sessionId || typeof sessionId !== "string") return res.status(400).json({ message: "缺少 sessionId" });

      // 已處理過：先驗證該交易屬於本人（避免 session 探測），再回成功
      const existingOwner = await storage.getPointTransactionOwner(sessionId);
      if (existingOwner) {
        if (existingOwner !== user.id) return res.status(403).json({ message: "無效的付款資訊" });
      }

      const stripe = await getStripe();
      const session = await stripe.checkout.sessions.retrieve(sessionId);

      const points = parseInt(session.metadata?.points || "0", 10);
      const amountTwd = parseInt(session.metadata?.amountTwd || "0", 10);
      let validation;
      try {
        validation = validatePlatformAiPointsCheckout({
          session,
          userId: user.id,
          stripeCustomerId: user.stripeCustomerId,
          points,
          amountTwd,
        });
      } catch (error: any) {
        if (error?.message === "INVALID_PLATFORM_CHECKOUT") {
          return res.status(403).json({ message: "無效的付款資訊" });
        }
        throw error;
      }
      if (validation.status === "pending") {
        return res.json({ success: false, status: "pending" });
      }
      if (validation.status !== "paid" || !validation.conversion) {
        return res.json({ success: false, status: validation.status });
      }

      if (existingOwner) {
        const summary = await storage.getAiCreditSummary(user.id);
        return res.json({
          success: true,
          alreadyProcessed: true,
          points: summary.points,
          conversion: validation.conversion,
        });
      }
      // 交易記錄 + 加點同一個 DB transaction（冪等 + 一致性，可安全重試）
      const result = await storage.creditPointPurchase({ userId: user.id, points, amountTwd, stripeSessionId: sessionId });
      res.json({
        success: true,
        added: result.alreadyProcessed ? 0 : points,
        points: result.points,
        alreadyProcessed: result.alreadyProcessed,
        conversion: validation.conversion,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // 超級管理員手動贈送點數
  app.post("/api/super-admin/users/:id/grant-points", requireAdmin, async (req, res) => {
    res.status(410).json({ message: "This legacy mutation is retired; use /api/management/members/:userId/ai-grants" });
  });

  // ============ Registration Routes ============
  app.post("/api/registrations", async (req, res) => {
    try {
      const body = { ...req.body };
      const requestedExternalOrigin = body.externalJourneyOrigin;
      delete body.externalJourneyOrigin;
      const analyticsVisitorToken = body.analyticsVisitorToken === undefined
        ? undefined
        : analyticsVisitorTokenSchema.parse(body.analyticsVisitorToken);
      delete body.analyticsVisitorToken;
      const requestedSession = body.selectedSession;
      const jitSelectionToken = body.jitSelectionToken;
      delete body.selectedSession;
      delete body.jitSelectionToken;
      // tags 為後台專用，禁止公開報名端設定
      delete body.tags;
      if (typeof body.email === "string") body.email = body.email.trim().toLowerCase();
      let data = insertRegistrationSchema.parse(body);

      const webinarCheck = await storage.getWebinar(data.webinarId);
      if (!webinarCheck || webinarCheck.publishStatus !== "published") {
        return res.status(403).json({ message: "此直播間尚未發佈，無法報名" });
      }
      const publishedLanding = await storage.getPublicWebinarLandingPage(webinarCheck.id);
      const [publishedJourney] = await db.select({ publishedSettings: externalJourneySettings.publishedSettings })
        .from(externalJourneySettings).where(eq(externalJourneySettings.webinarId, webinarCheck.id)).limit(1);
      const journeySettings = publishedJourney?.publishedSettings
        ? externalJourneySettingsSchema.parse(publishedJourney.publishedSettings)
        : undefined;
      if (!publishedLanding && journeySettings?.landingMode !== "external") {
        return res.status(403).json({ message: "此說明會落地頁尚未發布，暫時無法報名" });
      }
      // External registrants may bind their source origin, but it must be the
      // exact published allowlist origin. Never accept this as an authority
      // signal or use it to select a different webinar.
      if (requestedExternalOrigin !== undefined) {
        if (typeof requestedExternalOrigin !== "string") return res.status(400).json({ message: "Invalid external journey origin" });
        let normalizedOrigin: string;
        try { normalizedOrigin = new URL(requestedExternalOrigin).origin; } catch { return res.status(400).json({ message: "Invalid external journey origin" }); }
        if (!journeySettings?.approvedOrigins.includes(normalizedOrigin)) return res.status(403).json({ message: "External journey origin is not approved" });
        data = { ...data, landingUrl: normalizedOrigin };
      } else {
        // Browsers supply Origin for cross-site form posts. It is attribution
        // metadata only, and is recorded only when it exactly matches the
        // owner's published allowlist; same-origin legacy forms keep their
        // existing behavior.
        const browserOrigin = req.get("Origin");
        try {
          const normalizedOrigin = browserOrigin ? new URL(browserOrigin).origin : undefined;
          if (normalizedOrigin && journeySettings?.approvedOrigins.includes(normalizedOrigin)) {
            data = { ...data, landingUrl: normalizedOrigin };
          }
        } catch { /* malformed Origin is not attribution */ }
      }
      if (!process.env.SESSION_SECRET) {
        return res.status(503).json({ message: "Registration is temporarily unavailable" });
      }
      const persistedSessions = await storage.getWebinarSessions(webinarCheck.id);
      const eligibilityNow = new Date();
      const availability = getAvailableSessions(webinarCheck, persistedSessions, eligibilityNow);
      const isScheduledChoice = availability.sessions.some(session =>
        session.id !== "jit" && session.scheduledStart.getTime() === new Date(requestedSession).getTime());
      const selectedSession = availability.mode === "justInTime" && !isScheduledChoice
        ? (() => {
          if (requestedSession == null || requestedSession === "") {
            if (availability.onDemandAvailable) return null;
            throw new Error("請選擇有效的場次");
          }
          const signedSlot = verifyJitSelectionToken(jitSelectionToken, webinarCheck.id);
          const requested = new Date(requestedSession);
          if (!signedSlot || !Number.isFinite(requested.getTime()) || requested.getTime() !== signedSlot.getTime()) {
            throw new Error("所選即時場次無效或已過期");
          }
          return signedSlot;
        })()
        : normalizeSelectedSession(requestedSession, availability, eligibilityNow);
      data = { ...data, selectedSession };
      
      const existing = await storage.getRegistrationByEmail(data.webinarId, data.email);
      if (existing) {
        return res.status(400).json({ message: "此 Email 已報名" });
      }
      
      if (!webinarCheck.userId) {
        return res.status(503).json({ message: "此 Webinar 的帳號設定不完整，暫時無法報名" });
      }
      const webinarOwner = await storage.getUser(webinarCheck.userId);
      if (!webinarOwner || !await hasStoredPublicEntitlement(webinarOwner)) {
        return res.status(403).json({ message: "SUBSCRIPTION_REQUIRED", code: "SUBSCRIPTION_REQUIRED" });
      }
      const manual = await activeMemberManualPlan(webinarOwner.id);
      const paidActive = ["active", "trialing"].includes(webinarOwner.subscriptionStatus)
        && (!webinarOwner.planExpiresAt || webinarOwner.planExpiresAt.getTime() > Date.now());
      // The historical publishing-only override admitted an expired catalog
      // member with that catalog's registration cap. Preserve that behavior;
      // free override recipients remain uncapped exactly as before.
      const storedPlanHasLimit = webinarOwner.subscriptionPlan in SUBSCRIPTION_PLANS;
      const monthlyRegistrantLimit = effectiveMonthlyRegistrantLimit(
        webinarOwner.subscriptionPlan, paidActive || storedPlanHasLimit, manual,
      );
      const registration = monthlyRegistrantLimit
        ? await storage.createRegistrationWithinMonthlyLimit(
            webinarCheck.userId,
            data,
            monthlyRegistrantLimit,
            analyticsVisitorToken,
          )
        : await storage.createRegistration(data, analyticsVisitorToken);
      if (!registration) {
        return res.status(429).json({ message: "此 Webinar 帳號已達本月報名人數上限" });
      }
      const watchToken = createWatchToken(
        registration.id,
        registration.webinarId,
        watchTokenExpiry(registration.selectedSession, webinarCheck.replayAvailableHours ?? 48),
      );
      
      dispatchWebhook(data.webinarId, "registration", {
         // Retain legacy registration fields while adding stable attribution
         // fields so receivers can safely dedupe without parsing PII.
         registrationId: registration.id, name: data.name, email: data.email,
         webinarId: registration.webinarId,
         sessionId: registration.selectedSession
           ? persistedSessions.find(session => new Date(session.scheduledStart).getTime() === new Date(registration.selectedSession!).getTime())?.id || null
           : null,
         selectedSession: registration.selectedSession?.toISOString?.() || null,
         eventId: `registration:${registration.id}`,
      });
      
      const webinar = await storage.getWebinar(data.webinarId);
      if (webinar) {
        const baseUrl = appBaseUrl();
        try {
          await createEmailRemindersForRegistration(registration, webinar, baseUrl, watchToken);
        } catch (reminderError) {
          console.error("Failed to create reminders:", reminderError);
        }
      }
      
       // The normal built-in response remains compatible. An external
       // destination is emitted only after the registration transaction has
       // succeeded; the opaque handoff has no registration PII or watch token.
       const enrichment = await optionalRegistrationEnrichment(() => externalThankYouForRegistration(
         registration,
         `/webinar/${encodeURIComponent(registration.webinarId)}?watchToken=${encodeURIComponent(watchToken)}`,
         req.get("host") || undefined,
       ));
       if (!enrichment.available) console.warn("External thank-you enrichment unavailable");
       res.json({
         ...registration, watchToken,
         ...(enrichment.available && enrichment.value ? { externalThankYou: enrichment.value } : {}),
         ...(!enrichment.available ? { externalThankYouUnavailable: true } : {}),
       });
    } catch (error: any) {
      res.status(error?.code === "REGISTRATION_CONFLICT" ? 409 : 400).json({ message: error.message });
    }
  });

  app.patch("/api/webinars/:id/registrations/:regId/tags", requireWebinarOwner, async (req, res) => {
    try {
      const reg = await storage.getRegistration(req.params.regId as string);
      if (!reg || reg.webinarId !== req.params.id) {
        return res.status(404).json({ message: "找不到此報名記錄" });
      }
      const tags = Array.isArray(req.body.tags)
        ? req.body.tags.map((t: any) => String(t).trim()).filter(Boolean)
        : [];
      const updated = await storage.updateRegistrationForWebinar(
        req.params.id as string,
        req.params.regId as string,
        { tags },
      );
      res.json(updated);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/webinars/:id/registrations", requireWebinarOwner, async (req, res) => {
    const registrations = await storage.getRegistrationsByWebinar(req.params.id as string);
    res.json(registrations);
  });

  app.get("/api/webinars/:id/session-registration-counts", requireWebinarOwner, async (req, res) => {
    try {
      const webinar = await storage.getWebinar(req.params.id as string);
      if (!webinar) return res.status(404).json({ message: "Webinar not found" });
      const counts = await getSessionRegistrationCounts(
        webinar.userId || req.session.userId!,
        webinar.id,
      );
      if (!counts) return res.status(404).json({ message: "Webinar not found" });
      res.json(counts);
    } catch (error: any) {
      res.status(500).json({ message: error?.message || "Unable to load session registration counts" });
    }
  });

  // Owner-only, read-only deterministic sales insights.
  app.get("/api/webinars/:id/lead-insights", requireWebinarOwner, async (req, res) => {
    const webinar = await storage.getWebinar(req.params.id as string);
    if (!webinar) return res.status(404).json({ message: "Webinar not found" });
    if (await denyAdvancedTrialOnly(res, webinar.userId)) return;
    const rawLimit = Number(req.query.limit ?? 50);
    const rawOffset = Number(req.query.offset ?? 0);
    const limit = Number.isInteger(rawLimit) ? Math.min(100, Math.max(1, rawLimit)) : 50;
    const offset = Number.isInteger(rawOffset) ? Math.max(0, rawOffset) : 0;
    const page = await storage.getRegistrationsByWebinarPage(req.params.id as string, limit, offset);
    const events = await storage.getFunnelEventsByRegistrations(
      req.params.id as string,
      page.registrations.map(registration => registration.id),
    );
    const result = buildLeadInsights(page.registrations, events, webinar);
    res.json({
      webinarId: req.params.id,
      summary: result.summary,
      pagination: { total: page.total, limit, offset, hasMore: offset + result.insights.length < page.total },
      leads: result.insights.map(({ registrationId, score, stage, temperature, lastActivityAt, recommendation, evidenceCount }) =>
        ({ registrationId, score, stage, temperature, lastActivityAt, recommendation, evidenceCount })),
    });
  });

  app.get("/api/webinars/:id/registrations/:registrationId/insights", requireWebinarOwner, async (req, res) => {
    const webinar = await storage.getWebinar(req.params.id as string);
    if (!webinar) return res.status(404).json({ message: "Webinar not found" });
    if (await denyAdvancedTrialOnly(res, webinar.userId)) return;
    const registration = await storage.getRegistration(req.params.registrationId as string);
    if (!registration || registration.webinarId !== req.params.id) {
      return res.status(404).json({ message: "Registration not found" });
    }
    const events = await storage.getFunnelEventsByRegistration(req.params.id as string, registration.id);
    const insight = scoreLeadInsight(
      registration,
      events,
      webinar.videoDuration ?? 0,
    );
    res.json({
      registrationId: insight.registrationId,
      score: insight.score,
      stage: insight.stage,
      temperature: insight.temperature,
      lastActivityAt: insight.lastActivityAt,
      recommendation: insight.recommendation,
      evidenceCount: insight.evidenceCount,
      evidence: insight.evidence,
      timeline: insight.timeline,
    });
  });

  // ============ Fake Users Routes ============
  app.get("/api/webinars/:id/fake-users", requirePublishedOrOwner, async (req, res) => {
    const fakeUsers = await storage.getFakeUsersByWebinar(req.params.id as string);
    res.json(fakeUsers);
  });

  app.post("/api/webinars/:id/fake-users", requireWebinarOwner, withMediaReferenceLock(async (req, res) => {
    try {
      const data = insertFakeUserSchema.parse({
        ...req.body,
        webinarId: req.params.id
      });
      await verifyReferencedMediaUrls(data.avatar);
      const fakeUser = await storage.createFakeUser(data);
      res.json(fakeUser);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }));

  app.delete("/api/webinars/:id/fake-users/:userId", requireWebinarOwner, async (req, res) => {
    const deleted = await storage.deleteFakeUser(req.params.id as string, req.params.userId as string);
    if (!deleted) return res.status(404).json({ message: "Fake user not found" });
    res.json({ success: true });
  });

  app.get("/api/webinars/:id/chat-messages", requireWebinarOwner, async (req, res) => {
    const messages = await storage.getChatMessagesByWebinar(req.params.id as string);
    res.json(messages);
  });

  // ============ Scheduled Messages Routes ============
  app.get("/api/webinars/:id/scheduled-messages", requirePublishedOrOwner, async (req, res) => {
    const messages = await storage.getScheduledMessagesByWebinar(req.params.id as string);
    res.json(messages);
  });

  app.post("/api/webinars/:id/scheduled-messages", requireWebinarOwner, async (req, res) => {
    try {
      const data = insertScheduledMessageSchema.parse({
        ...req.body,
        webinarId: req.params.id
      });
      if (data.fakeUserId) {
        const belongs = (await storage.getFakeUsersByWebinar(req.params.id as string))
          .some((fakeUser) => fakeUser.id === data.fakeUserId);
        if (!belongs) return res.status(400).json({ message: "fakeUserId does not belong to this webinar" });
      }
      const message = await storage.createScheduledMessage(data);
      res.json(message);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/webinars/:id/scheduled-messages/:msgId", requireWebinarOwner, async (req, res) => {
    const deleted = await storage.deleteScheduledMessage(req.params.id as string, req.params.msgId as string);
    if (!deleted) return res.status(404).json({ message: "Scheduled message not found" });
    res.json({ success: true });
  });

  // ============ CTA Buttons Routes ============
  app.get("/api/webinars/:id/ctas", requirePublishedOrOwner, async (req, res) => {
    const ctas = await storage.getCtaButtonsByWebinar(req.params.id as string);
    res.json(ctas.map(cta => ({
      ...cta,
      ...(cta.salesPageId ? { url: productSalesPageTargetUrl(cta.webinarId, cta.id) } : {}),
    })));
  });

  app.post("/api/webinars/:id/ctas", requireWebinarOwner, async (req, res) => {
    try {
      const data = insertCtaButtonSchema.parse({
        ...req.body,
        webinarId: req.params.id
      });
      if (data.offerId) {
        const offer = await storage.getWebinarOffer(data.offerId);
        const webinar = await storage.getWebinar(req.params.id as string);
        if (!offer || !offer.active || !webinar?.userId || await resolveOfferOwnerId(offer) !== webinar.userId) {
          return res.status(400).json({ message: "offerId must be an available product owned by this member" });
        }
      }
      if (data.salesPageId) {
        const webinar = await storage.getWebinar(req.params.id as string);
        const [target] = await db.select({ page: offerSalesPages, offer: webinarOffers })
          .from(offerSalesPages)
          .innerJoin(webinarOffers, eq(offerSalesPages.offerId, webinarOffers.id))
          .where(and(
            eq(offerSalesPages.id, data.salesPageId),
            eq(offerSalesPages.status, "published"),
            sql`COALESCE(
              ${offerSalesPages.userId},
              ${webinarOffers.userId},
              (SELECT owner_webinar.user_id FROM webinars owner_webinar WHERE owner_webinar.id = ${webinarOffers.webinarId})
            ) = ${webinar?.userId || ""}`,
            sql`COALESCE(
              ${webinarOffers.userId},
              (SELECT owner_webinar.user_id FROM webinars owner_webinar WHERE owner_webinar.id = ${webinarOffers.webinarId})
            ) = ${webinar?.userId || ""}`,
            eq(webinarOffers.active, true),
            isNull(offerSalesPages.deletedAt),
          )).limit(1);
        if (!target) return res.status(400).json({ message: "salesPageId must be an available page owned by this member" });
      }
      const cta = await storage.createCtaButton(data);
      res.status(201).json({
        ...cta,
        ...(cta.salesPageId ? { url: productSalesPageTargetUrl(cta.webinarId, cta.id) } : {}),
      });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  const ctaPatchSchema = z.object({
    text: z.string().trim().min(1).optional(),
    url: safeCtaUrlSchema.nullish(),
    offerId: z.string().uuid().nullish(),
    salesPageId: z.string().uuid().nullish(),
    startTime: z.number().int().min(0).optional(),
    endTime: z.number().int().min(0).nullish(),
    style: z.string().trim().min(1).max(40).optional(),
  }).strict().refine(value => Object.keys(value).length > 0, "At least one field is required");

  app.patch("/api/webinars/:id/ctas/:ctaId", requireWebinarOwner, async (req, res) => {
    try {
      const webinarId = req.params.id as string;
      const existing = (await storage.getCtaButtonsByWebinar(webinarId))
        .find(item => item.id === req.params.ctaId);
      if (!existing) return res.status(404).json({ message: "CTA not found" });
      const patch = ctaPatchSchema.parse(req.body);
      const data = insertCtaButtonSchema.parse({
        webinarId,
        text: patch.text ?? existing.text,
        url: patch.url === undefined ? existing.url : patch.url,
        offerId: patch.offerId === undefined ? existing.offerId : patch.offerId,
        salesPageId: patch.salesPageId === undefined ? existing.salesPageId : patch.salesPageId,
        startTime: patch.startTime ?? existing.startTime,
        endTime: patch.endTime === undefined ? existing.endTime : patch.endTime,
        style: patch.style ?? existing.style,
      });
      const webinar = await storage.getWebinar(webinarId);
      if (data.offerId) {
        const offer = await storage.getWebinarOffer(data.offerId);
        if (!offer?.active || !webinar?.userId || await resolveOfferOwnerId(offer) !== webinar.userId) {
          return res.status(400).json({ message: "offerId must be an available product owned by this member" });
        }
      }
      if (data.salesPageId) {
        const [target] = await db.select({ page: offerSalesPages })
          .from(offerSalesPages)
          .innerJoin(webinarOffers, eq(offerSalesPages.offerId, webinarOffers.id))
          .where(and(
            eq(offerSalesPages.id, data.salesPageId),
            sql`COALESCE(
              ${offerSalesPages.userId},
              ${webinarOffers.userId},
              (SELECT owner_webinar.user_id FROM webinars owner_webinar WHERE owner_webinar.id = ${webinarOffers.webinarId})
            ) = ${webinar?.userId || ""}`,
            eq(offerSalesPages.status, "published"),
            isNull(offerSalesPages.deletedAt),
            sql`COALESCE(
              ${webinarOffers.userId},
              (SELECT owner_webinar.user_id FROM webinars owner_webinar WHERE owner_webinar.id = ${webinarOffers.webinarId})
            ) = ${webinar?.userId || ""}`,
            eq(webinarOffers.active, true),
          )).limit(1);
        if (!target) return res.status(400).json({ message: "salesPageId must be an available page owned by this member" });
      }
      const [updated] = await db.update(ctaButtons).set({
        text: data.text,
        url: data.url || null,
        offerId: data.offerId || null,
        salesPageId: data.salesPageId || null,
        startTime: data.startTime,
        endTime: data.endTime ?? null,
        style: data.style,
      }).where(and(eq(ctaButtons.id, existing.id), eq(ctaButtons.webinarId, webinarId))).returning();
      res.json({
        ...updated,
        ...(updated.salesPageId ? { url: productSalesPageTargetUrl(updated.webinarId, updated.id) } : {}),
      });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  const ecpayConnectionInput = z.object({
    merchantId: z.string().trim().regex(/^\d{7,10}$/, "MerchantID 必須為 7 至 10 位數字"),
    environment: z.enum(["stage", "production"]),
    hashKey: z.string().trim().min(8).max(64).regex(/^[\x21-\x7E]+$/).optional(),
    hashIv: z.string().trim().min(8).max(64).regex(/^[\x21-\x7E]+$/).optional(),
    enabled: z.boolean().default(false),
  }).strict();
  const publicConnection = (connection: typeof ecpayConnections.$inferSelect | undefined) => connection ? ({
    merchantId: connection.merchantId,
    environment: connection.environment,
    enabled: connection.enabled,
    verified: !!connection.verifiedAt,
    verifiedAt: connection.verifiedAt,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
    hasCredentials: !!connection.hashKeyEncrypted && !!connection.hashIvEncrypted,
  }) : null;

  app.get("/api/admin/ecpay-connection", requireAdmin, async (req, res) => {
    const [connection] = await db.select().from(ecpayConnections)
      .where(eq(ecpayConnections.userId, req.session.userId!)).limit(1);
    res.json(publicConnection(connection));
  });

  app.put("/api/admin/ecpay-connection", requireAdmin, async (req, res) => {
    try {
      const input = ecpayConnectionInput.parse(req.body);
      const [existing] = await db.select().from(ecpayConnections)
        .where(eq(ecpayConnections.userId, req.session.userId!)).limit(1);
      const usableHashKey = input.hashKey && !/^\*+$/.test(input.hashKey) ? input.hashKey : undefined;
      const usableHashIv = input.hashIv && !/^\*+$/.test(input.hashIv) ? input.hashIv : undefined;
      if (!existing && (!usableHashKey || !usableHashIv)) {
        return res.status(400).json({ message: "首次設定必須提供 HashKey 與 HashIV" });
      }
      const values = {
        merchantId: input.merchantId,
        environment: input.environment,
        enabled: input.enabled,
        hashKeyEncrypted: usableHashKey ? encryptEcpayCredential(usableHashKey) : existing!.hashKeyEncrypted,
        hashIvEncrypted: usableHashIv ? encryptEcpayCredential(usableHashIv) : existing!.hashIvEncrypted,
        // Credentials/environment changes invalidate any historical verification.
        verifiedAt: usableHashKey || usableHashIv || existing?.merchantId !== input.merchantId || existing?.environment !== input.environment
          ? null : existing?.verifiedAt,
        updatedAt: new Date(),
      } as const;
      const [saved] = existing
        ? await db.update(ecpayConnections).set(values).where(and(
            eq(ecpayConnections.id, existing.id),
            eq(ecpayConnections.userId, req.session.userId!),
          )).returning()
        : await db.insert(ecpayConnections).values({ userId: req.session.userId!, ...values }).returning();
      res.json(publicConnection(saved));
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.post("/api/admin/ecpay-connection/test", requireAdmin, async (req, res) => {
    const [connection] = await db.select().from(ecpayConnections)
      .where(eq(ecpayConnections.userId, req.session.userId!)).limit(1);
    if (!connection) return res.status(404).json({ message: "尚未設定 ECPay" });
    try {
      decryptEcpayCredential(connection.hashKeyEncrypted);
      decryptEcpayCredential(connection.hashIvEncrypted);
      // AIO has no safe credential-only probe. Do not claim provider verification.
      res.json({ configured: true, verified: false, message: "憑證已安全儲存；請以測試環境結帳完成實際驗證。" });
    } catch {
      res.status(409).json({ message: "無法解密已儲存的憑證，請重新輸入。" });
    }
  });

  app.post("/api/admin/ecpay-connection/disable", requireAdmin, async (req, res) => {
    const [saved] = await db.update(ecpayConnections).set({ enabled: false, updatedAt: new Date() })
      .where(eq(ecpayConnections.userId, req.session.userId!)).returning();
    res.json(publicConnection(saved));
  });

  app.delete("/api/admin/ecpay-connection", requireAdmin, async (req, res) => {
    const [connection] = await db.select({ id: ecpayConnections.id }).from(ecpayConnections)
      .where(eq(ecpayConnections.userId, req.session.userId!)).limit(1);
    if (connection) {
      const [referenced] = await db.select({ id: webinarPayments.id }).from(webinarPayments)
        .where(eq(webinarPayments.ecpayConnectionId, connection.id)).limit(1);
      if (referenced) {
        return res.status(409).json({ message: "此設定已有交易稽核紀錄，為確保回呼與帳務完整只能停用，無法刪除。" });
      }
    }
    await db.delete(ecpayConnections).where(eq(ecpayConnections.userId, req.session.userId!));
    res.json({ success: true });
  });

  app.post("/api/ecpay/return", async (req, res) => {
    const fail = () => res.type("text/plain").status(400).send("0|Error");
    try {
      if (!req.is("application/x-www-form-urlencoded")) return fail();
      const fields = Object.fromEntries(Object.entries(req.body || {}).filter(([, value]) => typeof value === "string")) as Record<string, string>;
      const tradeNo = fields.MerchantTradeNo;
      const merchantId = fields.MerchantID;
      if (!tradeNo || !merchantId) return fail();
      const [payment] = await db.select().from(webinarPayments).where(and(
        eq(webinarPayments.paymentProvider, "ecpay"),
        eq(webinarPayments.providerOrderId, tradeNo),
      )).limit(1);
      if (
        !payment ||
        !payment.ecpayConnectionId ||
        payment.merchantIdSnapshot !== merchantId
      ) return fail();
      const [connection] = await db.select({ id: ecpayConnections.id }).from(ecpayConnections)
        .where(eq(ecpayConnections.id, payment.ecpayConnectionId)).limit(1);
      if (!connection || !payment.providerHashKeySnapshot || !payment.providerHashIvSnapshot) return fail();
      const valid = validateEcpayCallbackIntegrity(
        fields,
        {
          merchantId: payment.merchantIdSnapshot!,
          merchantTradeNo: payment.providerOrderId!,
          amount: payment.amountMinor / 100,
          hashKey: decryptEcpayCredential(payment.providerHashKeySnapshot),
          hashIv: decryptEcpayCredential(payment.providerHashIvSnapshot),
        },
      );
      if (!valid || (payment.providerEnvironment === "production" && fields.SimulatePaid === "1")) return fail();
      await processVerifiedEcpayPayment(tradeNo, { rtnCode: fields.RtnCode, rtnMsg: fields.RtnMsg });
      return res.type("text/plain").send("1|OK");
    } catch {
      return fail();
    }
  });

  // Stripe owns Stripe offer product/price details. ECPay details are immutable
  // server-side offer snapshots so checkout never trusts browser amounts.
  app.get("/api/webinars/:id/sales-pages", requireWebinarOwner, async (req, res) => {
    res.json(await storage.listOfferSalesPages(req.params.id as string));
  });

  app.get("/api/webinars/:id/sales-pages/:pageId", requireWebinarOwner, async (req, res) => {
    const page = await storage.getOfferSalesPage(req.params.id as string, req.params.pageId as string);
    if (!page) return res.status(404).json({ message: "Sales page not found" });
    res.json(page);
  });

  app.post("/api/webinars/:id/sales-pages", requireWebinarOwner, withMediaReferenceLock(async (req, res) => {
    try {
      const webinarId = req.params.id as string;
      const input = createSalesPageSchema.parse(req.body);
      await verifyReferencedMediaUrls(input.blocks);
      const offer = await storage.getWebinarOffer(input.offerId);
      const webinar = await storage.getWebinar(webinarId);
      if (!offer || !offer.active || !webinar?.userId || await resolveOfferOwnerId(offer) !== webinar.userId) {
        return res.status(400).json({ message: "Offer must be active and owned by this member" });
      }
      const page = await storage.createOfferSalesPage({
        userId: webinar.userId,
        webinarId,
        offerId: offer.id,
        slug: input.slug,
        title: input.title,
        orderedBlocks: input.blocks,
         checkoutSettings: input.checkoutSettings,
      });
      res.status(201).json(page);
    } catch (error: any) {
      if (error?.code === "23505") {
        return res.status(409).json({ message: "Slug or offer already has a sales page" });
      }
      res.status(400).json({ message: error.message });
    }
  }));

  app.patch("/api/webinars/:id/sales-pages/:pageId", requireWebinarOwner, withMediaReferenceLock(async (req, res) => {
    try {
      const webinarId = req.params.id as string;
      const pageId = req.params.pageId as string;
      const input = updateSalesPageSchema.parse(req.body);
      if (input.blocks) await verifyReferencedMediaUrls(input.blocks);
      const existing = await storage.getOfferSalesPage(webinarId, pageId);
      if (!existing) return res.status(404).json({ message: "Sales page not found" });
      if (existing.status === "published" && (
        (input.title !== undefined && input.title !== existing.title) ||
        (input.slug !== undefined && input.slug !== existing.slug)
      )) {
        return res.status(409).json({ message: "Unpublish the sales page before changing its public title or slug" });
      }
      if (existing.status === "published" && input.blocks !== undefined) {
        validatePublishableBlocks(input.blocks);
      }
      const page = await storage.updateOfferSalesPage(webinarId, pageId, input.version, {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.slug !== undefined ? { slug: input.slug } : {}),
        ...(input.blocks !== undefined ? { orderedBlocks: input.blocks } : {}),
         ...(input.checkoutSettings !== undefined ? { checkoutSettings: normalizeCheckoutSettings(input.checkoutSettings) } : {}),
      });
      if (!page) return res.status(409).json({ message: "Version conflict", code: "VERSION_CONFLICT" });
      res.json(page);
    } catch (error: any) {
      if (error?.code === "23505") return res.status(409).json({ message: "Slug is already in use" });
      res.status(400).json({ message: error.message });
    }
  }));

  app.post("/api/webinars/:id/sales-pages/:pageId/publish", requireWebinarOwner, withMediaReferenceLock(async (req, res) => {
    try {
      const webinarId = req.params.id as string;
      const pageId = req.params.pageId as string;
      const input = salesPageVersionSchema.parse(req.body);
      const [page, webinar] = await Promise.all([
        storage.getOfferSalesPage(webinarId, pageId),
        storage.getWebinar(webinarId),
      ]);
      if (!page || !webinar) return res.status(404).json({ message: "Sales page not found" });
      const offer = await storage.getWebinarOffer(page.offerId);
      if (!offer || !webinar.userId || await resolveOfferOwnerId(offer) !== webinar.userId) {
        return res.status(409).json({ message: "Linked offer is unavailable" });
      }
      const owner = await storage.getUser(webinar.userId);
      if (!await hasStoredPublicEntitlement(owner)) {
        return res.status(403).json({ message: "SUBSCRIPTION_REQUIRED", code: "SUBSCRIPTION_REQUIRED" });
      }
      const allowed = salesPageCanPublish(webinar, offer, page.orderedBlocks);
      if (!allowed.ok) return res.status(409).json({ message: allowed.message });
      await verifyReferencedMediaUrls(allowed.blocks);
      const published = await storage.setOfferSalesPageStatus(webinarId, pageId, input.version, "published");
      if (!published) return res.status(409).json({ message: "Version conflict or publication requirements changed", code: "VERSION_CONFLICT" });
      res.json(published);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }));

  app.post("/api/webinars/:id/sales-pages/:pageId/unpublish", requireWebinarOwner, async (req, res) => {
    try {
      const webinarId = req.params.id as string;
      const pageId = req.params.pageId as string;
      const input = salesPageVersionSchema.parse(req.body);
      const existing = await storage.getOfferSalesPage(webinarId, pageId);
      if (!existing) return res.status(404).json({ message: "Sales page not found" });
      const page = await storage.setOfferSalesPageStatus(webinarId, pageId, input.version, "draft");
      if (!page) return res.status(409).json({ message: "Version conflict", code: "VERSION_CONFLICT" });
      res.json(page);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/webinars/:id/sales-pages/:pageId", requireWebinarOwner, async (req, res) => {
    const deleted = await storage.deleteOfferSalesPage(req.params.id as string, req.params.pageId as string);
    if (!deleted) return res.status(404).json({ message: "Sales page not found" });
    res.json({ success: true });
  });

  app.get("/api/sales-pages/:slug", async (req, res) => {
    try {
      const slug = salesPageSlugSchema.parse(req.params.slug);
      const result = await storage.getPublicOfferSalesPage(slug);
      if (!result) return res.status(404).json({ message: "Sales page not found" });
       const { page, offer } = result;
       const ownerId = page.userId || await resolveOfferOwnerId(offer);
       const owner = ownerId ? await storage.getUser(ownerId) : undefined;
       if (!await hasStoredPublicEntitlement(owner)) {
         return res.status(404).json({ message: "Sales page not found" });
       }
       const publicCheckout = normalizeCheckoutSettings(page.publishedCheckoutSettings);
       const { successButtonUrl: _successButtonUrl, successTitle: _successTitle, successMessage: _successMessage, successButtonLabel: _successButtonLabel, ...publicCheckoutSettings } = publicCheckout;
      let display: { name: string; amountMinor: number | null; currency: string };
      if (offer.paymentProvider === "ecpay") {
        display = { name: offer.ecpayItemName!, amountMinor: (offer.ecpayAmountTwd || 0) * 100, currency: "TWD" };
      } else {
        const stripe = await getUncachableStripeClient();
        const [product, price] = await Promise.all([
          stripe.products.retrieve(offer.stripeProductId!),
          stripe.prices.retrieve(offer.stripePriceId!),
        ]);
        display = {
          name: "deleted" in product ? "Unavailable product" : product.name,
          amountMinor: price.unit_amount,
          currency: price.currency.toUpperCase(),
        };
      }
      res.json({
        id: page.id,
        webinarId: page.webinarId,
        offerId: page.offerId,
        slug: page.slug,
        title: page.title,
         blocks: page.publishedOrderedBlocks ?? [],
         checkoutSettings: publicCheckoutSettings,
        publishedAt: page.publishedAt,
        offer: {
          paymentProvider: offer.paymentProvider,
          checkoutMode: offer.checkoutMode,
          ...display,
        },
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: error.message });
      res.status(502).json({ message: "Offer display is temporarily unavailable" });
    }
  });

  // This endpoint intentionally accepts the provider identifier only as a
  // lookup key. Query-string state is never used as payment proof, and the
  // response contains no purchaser or cross-order information.
  app.get("/api/public/checkout-status", async (req, res) => {
    const sessionId = typeof req.query.session_id === "string" ? req.query.session_id : "";
    const orderId = typeof req.query.order_id === "string" ? req.query.order_id : "";
    const provider = typeof req.query.provider === "string" ? req.query.provider : "";
    const statusToken = typeof req.query.status_token === "string" ? req.query.status_token : "";
    if (!statusToken || !validCheckoutStatusToken(statusToken)) return res.status(403).json({ status: "unknown" });
    if (orderId || provider === "ecpay") {
      if (orderId && !/^[A-Za-z0-9_-]{8,64}$/.test(orderId)) return res.status(400).json({ status: "unknown" });
      const [payment] = await db.select({ status: webinarPayments.status, checkoutStatusTokenHash: webinarPayments.checkoutStatusTokenHash, checkoutSettingsSnapshot: webinarPayments.checkoutSettingsSnapshot, offerSlugSnapshot: webinarPayments.offerSlugSnapshot })
        .from(webinarPayments).where(and(
          eq(webinarPayments.paymentProvider, "ecpay"),
          eq(webinarPayments.checkoutStatusTokenHash, checkoutStatusTokenHash(statusToken)),
        )).limit(1);
      if (!payment || payment.checkoutStatusTokenHash !== checkoutStatusTokenHash(statusToken)) return res.status(403).json({ status: "unknown" });
      const state = payment.status === "paid" ? "paid" : payment.status === "pending" ? "pending" : "failed";
      return res.json({ status: state, ...(state === "paid" ? { checkoutSettings: payment.checkoutSettingsSnapshot } : {}), offerSlug: payment.offerSlugSnapshot });
    }
    if (!/^cs_[A-Za-z0-9_=-]{8,200}$/.test(sessionId)) {
      return res.status(400).json({ status: "unknown" });
    }
    const [payment] = await db.select({ status: webinarPayments.status, checkoutStatusTokenHash: webinarPayments.checkoutStatusTokenHash, checkoutSettingsSnapshot: webinarPayments.checkoutSettingsSnapshot, offerSlugSnapshot: webinarPayments.offerSlugSnapshot })
      .from(webinarPayments)
      .where(eq(webinarPayments.stripeCheckoutSessionId, sessionId)).limit(1);
    if (!payment || payment.checkoutStatusTokenHash !== checkoutStatusTokenHash(statusToken)) return res.status(403).json({ status: "unknown" });
    const state = payment.status === "paid" ? "paid"
        : payment.status === "pending" ? "pending"
        : payment.status === "canceled" ? "canceled" : "failed";
    return res.json({
      status: state,
      ...(state === "paid" ? { checkoutSettings: payment.checkoutSettingsSnapshot } : {}),
      offerSlug: payment.offerSlugSnapshot,
    });
  });

  app.get("/api/webinars/:id/offers", requireWebinarOwner, async (req, res) => {
    try {
      const webinarId = req.params.id as string;
      const offers = await storage.getWebinarOffers(webinarId);
      const result = await Promise.all(offers.map(async (offer) => {
        if (offer.paymentProvider === "ecpay") {
          return { ...offer, name: offer.ecpayItemName, amountMinor: (offer.ecpayAmountTwd || 0) * 100, currency: "TWD" };
        }
        const stripe = await getUncachableStripeClient();
        const [product, price] = await Promise.all([
          stripe.products.retrieve(offer.stripeProductId!),
          stripe.prices.retrieve(offer.stripePriceId!),
        ]);
        return {
          ...offer,
          name: "deleted" in product ? "Unavailable product" : product.name,
          amountMinor: price.unit_amount,
          currency: price.currency.toUpperCase(),
        };
      }));
      res.json(result);
    } catch (error: any) {
      res.status(502).json({ message: error.message });
    }
  });

  app.post("/api/webinars/:id/offers", requireWebinarOwner, async (req, res) => {
    try {
      const webinarId = req.params.id as string;
      const webinar = await storage.getWebinar(webinarId);
      if (!webinar?.userId) return res.status(404).json({ message: "Webinar not found" });
      const input = createWebinarOfferSchema.parse(req.body);
      if (input.paymentProvider !== "ecpay") {
        return res.status(400).json({ message: "Webinar product checkout must use the member's ECPay account" });
      }
      if (input.amountMinor % 100 !== 0) {
        return res.status(400).json({ message: "ECPay TWD amount must be a whole-dollar value in minor units" });
      }
      const [connection] = await db.select().from(ecpayConnections).where(and(
        eq(ecpayConnections.userId, webinar.userId),
        eq(ecpayConnections.enabled, true),
      )).limit(1);
      if (!connection) return res.status(409).json({ message: "請先設定並啟用 ECPay 金流" });
      const offer = await storage.createWebinarOffer({
        userId: webinar.userId,
        webinarId,
        paymentProvider: "ecpay",
        ecpayItemName: input.name,
        ecpayAmountTwd: input.amountMinor / 100,
        checkoutMode: "payment",
      });
      res.json({ ...offer, name: offer.ecpayItemName, amountMinor: (offer.ecpayAmountTwd || 0) * 100, currency: "TWD" });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  const offerCheckoutSchema = z.object({
    ctaId: z.string().uuid().optional(),
    offerId: z.string().uuid().optional(),
    salesPageId: z.string().uuid().optional(),
    registrationId: z.string().uuid().optional(),
    // Required when a registrationId is used. The signature binds this
    // registration to the webinar; an arbitrary public UUID is not identity.
    watchToken: z.string().trim().min(16).max(1_000).optional(),
    buyer: z.object({
      name: z.string().trim().min(1).max(200),
      email: z.string().trim().email().max(320).transform(value => value.toLowerCase()),
    }).strict().optional(),
    visitorToken: analyticsVisitorTokenSchema.optional(),
    sessionId: z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9_-]+$/).optional(),
  }).strict()
    .refine(value =>
      (Boolean(value.ctaId) && !value.offerId && !value.salesPageId) ||
      (!value.ctaId && Boolean(value.offerId) && Boolean(value.salesPageId)),
    {
      message: "CTA checkout requires only ctaId; direct sales-page checkout requires offerId and salesPageId",
    })
    .refine(value => value.registrationId || value.visitorToken || value.sessionId, {
      message: "A visitor identity is required",
    })
    .refine(value => Boolean(value.registrationId || value.buyer), {
      message: "buyer { name, email } is required when no verified registrationId is supplied",
    });

  app.post("/api/webinars/:id/offer-checkout", async (req, res) => {
    try {
      const webinarId = req.params.id;
      const input = offerCheckoutSchema.parse(req.body);
      const webinar = await storage.getWebinar(webinarId);
      if (!webinar || webinar.publishStatus !== "published") return res.status(404).json({ message: "Webinar not found" });
      const owner = webinar.userId ? await storage.getUser(webinar.userId) : undefined;
      if (!await hasStoredPublicEntitlement(owner)) {
        return res.status(403).json({ message: "SUBSCRIPTION_REQUIRED", code: "SUBSCRIPTION_REQUIRED" });
      }
      let cta: Awaited<ReturnType<typeof storage.getCtaButtonsByWebinar>>[number] | undefined;
      let offer: Awaited<ReturnType<typeof storage.getWebinarOffer>> | undefined;
      let salesPageId: string | undefined;
      let salesPageVersion: number | undefined;
      let checkoutSettingsSnapshot: ReturnType<typeof normalizeCheckoutSettings> | undefined;
      let offerSlugSnapshot: string | undefined;
      if (input.ctaId) {
        // A persisted CTA is the established webinar-room attribution flow.
        cta = (await storage.getCtaButtonsByWebinar(webinarId)).find(item => item.id === input.ctaId);
        if (!cta) {
          const [persistedLiveCta] = await db.select().from(ctaButtons).where(and(
            eq(ctaButtons.id, input.ctaId),
            eq(ctaButtons.webinarId, webinarId),
            eq(ctaButtons.liveOnly, true),
            isNull(ctaButtons.archivedAt),
            sql`${ctaButtons.expiresAt} > now()`,
          )).limit(1);
          cta = persistedLiveCta;
        }
        if (!cta?.offerId) return res.status(400).json({ message: "CTA is not linked to an offer" });
        offer = await storage.getWebinarOffer(cta.offerId);
        if (!offer || !offer.active || !webinar.userId || await resolveOfferOwnerId(offer) !== webinar.userId) {
          return res.status(400).json({ message: "Offer is unavailable" });
        }
        const [linkedPageRow] = await db.select({ page: offerSalesPages }).from(offerSalesPages)
          .innerJoin(webinarOffers, eq(offerSalesPages.offerId, webinarOffers.id))
          .where(and(
          eq(offerSalesPages.offerId, offer.id),
          sql`COALESCE(
            ${offerSalesPages.userId},
            ${webinarOffers.userId},
            (SELECT owner_webinar.user_id FROM webinars owner_webinar WHERE owner_webinar.id = ${webinarOffers.webinarId})
          ) = ${webinar.userId}`,
          eq(offerSalesPages.status, "published"),
          isNull(offerSalesPages.deletedAt),
          )).limit(1);
        const linkedPage = linkedPageRow?.page;
        if (linkedPage) {
          salesPageId = linkedPage.id;
          salesPageVersion = linkedPage.version;
          checkoutSettingsSnapshot = normalizeCheckoutSettings(linkedPage.publishedCheckoutSettings);
          offerSlugSnapshot = linkedPage.slug;
        }
      } else {
        // Public page IDs are untrusted: bind page, offer, and current publication
        // state in one storage query immediately before any provider/DB work.
        const context = await storage.getPublishedSalesPageCheckoutContext(
          webinarId,
          input.offerId!,
          input.salesPageId!,
        );
        if (!context) return res.status(404).json({ message: "Sales page or offer is unavailable" });
        offer = context.offer;
        salesPageId = context.page.id;
        salesPageVersion = context.page.version;
        checkoutSettingsSnapshot = normalizeCheckoutSettings(context.page.publishedCheckoutSettings);
        offerSlugSnapshot = context.page.slug;
      }
      let buyer: { name: string; email: string } | undefined;
      if (input.registrationId) {
        const suppliedWatchToken = input.watchToken ||
          req.get("Authorization")?.replace(/^Bearer\s+/i, "") ||
          req.get("X-Watch-Token");
        if (!verifyWatchTokenFor(suppliedWatchToken, input.registrationId, webinarId)) {
          return res.status(403).json({ message: "A valid watchToken bound to registrationId is required for registered checkout" });
        }
        const registration = await storage.getRegistration(input.registrationId);
        if (!registration || registration.webinarId !== webinarId) {
          return res.status(400).json({ message: "registrationId does not belong to this webinar" });
        }
        // Registration identity is server-verified and wins over any browser
        // buyer payload so callers cannot cross-bind arbitrary identities.
        buyer = { name: registration.name, email: registration.email };
      } else {
        buyer = input.buyer;
      }

      const visitorTokenHash = input.visitorToken ? sha256(input.visitorToken) : "";
      if (offer.paymentProvider !== "ecpay") {
        return res.status(409).json({ message: "Webinar product checkout must use ECPay" });
      }
      if (offer.paymentProvider === "ecpay") {
        const amountTwd = offer.ecpayAmountTwd;
        if (!webinar.userId || !offer.ecpayItemName || !Number.isInteger(amountTwd) || amountTwd === null || amountTwd <= 0) {
          return res.status(409).json({ message: "ECPay offer is unavailable" });
        }
        const [connection] = await db.select().from(ecpayConnections).where(and(
          eq(ecpayConnections.userId, webinar.userId),
          eq(ecpayConnections.enabled, true),
        )).limit(1);
        if (!connection) return res.status(409).json({ message: "ECPay checkout is unavailable" });
        const tradeNo = merchantTradeNo();
        const statusToken = createCheckoutStatusToken();
        const clientBackUrl = `${appBaseUrl()}/purchase-result?p=e&t=${statusToken}`;
        if (clientBackUrl.length > 200) return res.status(409).json({ message: "ECPay return URL exceeds the 200 character provider limit; configure a shorter APP_BASE_URL" });
        const [payment] = await db.insert(webinarPayments).values({
          userId: webinar.userId,
          webinarId,
          offerId: offer.id,
          ctaId: cta?.id,
          registrationId: input.registrationId,
          visitorTokenHash: visitorTokenHash || null,
          paymentProvider: "ecpay",
          providerOrderId: tradeNo,
           checkoutStatusTokenHash: checkoutStatusTokenHash(statusToken),
           salesPageId,
           originSalesPageIdSnapshot: salesPageId,
           salesPageVersion,
           checkoutSettingsSnapshot,
           offerSlugSnapshot,
          ecpayConnectionId: connection.id,
          merchantIdSnapshot: connection.merchantId,
          providerEnvironment: connection.environment,
          providerHashKeySnapshot: connection.hashKeyEncrypted,
          providerHashIvSnapshot: connection.hashIvEncrypted,
          productNameSnapshot: offer.ecpayItemName,
          buyerNameSnapshot: buyer!.name,
          buyerEmailSnapshot: buyer!.email,
          providerStatus: "checkout_started",
          providerStatusMessage: "Awaiting payment confirmation",
          amountMinor: amountTwd * 100,
          currency: "TWD",
          status: "pending",
        }).returning();
        await appendMemberOrderEvent(db, {
          paymentId: payment.id,
          type: "checkout_started",
          details: { provider: "ecpay" },
        });
        const fields: Record<string, string | number> = {
          MerchantID: connection.merchantId,
          MerchantTradeNo: tradeNo,
          MerchantTradeDate: merchantTradeDate(),
          PaymentType: "aio",
          TotalAmount: amountTwd,
          TradeDesc: "Webinar offer",
          ItemName: offer.ecpayItemName.replace(/[<>&#]/g, " ").slice(0, 200),
          ReturnURL: `${appBaseUrl()}/api/ecpay/return`,
           ClientBackURL: clientBackUrl,
          ChoosePayment: "ALL",
          EncryptType: "1",
        };
        fields.CheckMacValue = createCheckMacValue(
          fields,
          decryptEcpayCredential(connection.hashKeyEncrypted),
          decryptEcpayCredential(connection.hashIvEncrypted),
        );
        await storage.createFunnelEvent({
          webinarId, eventType: "checkout_start", registrationId: input.registrationId,
          sessionId: input.sessionId, ctaId: cta?.id, ctaKey: cta?.ctaKey, offerId: offer.id,
          visitorTokenHash: visitorTokenHash || undefined, dedupeKey: sha256(`checkout:ecpay:${tradeNo}`),
          metadata: { serverRecorded: true },
        });
        return res.json({ provider: "ecpay", action: ecpayActionUrl(connection.environment as "stage" | "production"), fields });
      }

      const stripe = await getUncachableStripeClient();
      const price = await stripe.prices.retrieve(offer.stripePriceId!);
      const productId = typeof price.product === "string" ? price.product : price.product.id;
      if (!price.active || price.type !== "one_time" || price.unit_amount === null || productId !== offer.stripeProductId) {
        return res.status(409).json({ message: "Offer price is unavailable" });
      }
      const statusToken = createCheckoutStatusToken();
      const [pendingPayment] = await db.insert(webinarPayments).values({
        userId: webinar.userId!,
        webinarId,
        offerId: offer.id,
        ctaId: cta?.id,
        registrationId: input.registrationId,
        visitorTokenHash: visitorTokenHash || null,
        paymentProvider: "stripe",
        checkoutStatusTokenHash: checkoutStatusTokenHash(statusToken),
        salesPageId,
        originSalesPageIdSnapshot: salesPageId,
        salesPageVersion,
        checkoutSettingsSnapshot,
        offerSlugSnapshot,
        productNameSnapshot: offer.ecpayItemName || null,
        buyerNameSnapshot: buyer!.name,
        buyerEmailSnapshot: buyer!.email,
        providerStatus: "checkout_started",
        providerStatusMessage: "Awaiting payment confirmation",
        amountMinor: price.unit_amount,
        currency: price.currency.toUpperCase(),
        status: "pending",
      }).returning({ id: webinarPayments.id });
      await appendMemberOrderEvent(db, {
        paymentId: pendingPayment.id,
        type: "checkout_started",
        details: { provider: "stripe" },
      });
      const metadata = {
        kind: "webinar_offer",
        webinarId,
        offerId: offer.id,
        ...(cta ? { ctaId: cta.id } : {}),
        stripePriceId: offer.stripePriceId,
        ...(input.registrationId ? { registrationId: input.registrationId } : {}),
        ...(visitorTokenHash ? { visitorTokenHash } : {}),
        checkoutStatusTokenHash: checkoutStatusTokenHash(statusToken),
        ...(salesPageId ? { salesPageId } : {}),
        ...(salesPageId ? { originSalesPageIdSnapshot: salesPageId } : {}),
        ...(salesPageVersion ? { salesPageVersion: String(salesPageVersion) } : {}),
        paymentId: pendingPayment.id,
      };
       const baseUrl = appBaseUrl();
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: [{ price: offer.stripePriceId!, quantity: 1 }],
        metadata,
        payment_intent_data: { metadata },
        client_reference_id: input.registrationId || undefined,
         success_url: `${baseUrl}/purchase-result?provider=stripe&session_id={CHECKOUT_SESSION_ID}&status_token=${encodeURIComponent(statusToken)}`,
         cancel_url: `${baseUrl}/purchase-result?provider=stripe&session_id={CHECKOUT_SESSION_ID}&status_token=${encodeURIComponent(statusToken)}&checkout=canceled`,
      });
       // Persist a pending local order before sending the browser to Stripe.
       // The verified webhook uses the unique session id and upgrades this
       // row atomically, while older/replayed webhooks remain idempotent.
       await db.update(webinarPayments).set({ stripeCheckoutSessionId: session.id, updatedAt: new Date() })
         .where(eq(webinarPayments.id, pendingPayment.id));
      await storage.createFunnelEvent({
        webinarId,
        eventType: "checkout_start",
        registrationId: input.registrationId,
        sessionId: input.sessionId,
        ctaId: cta?.id,
        ctaKey: cta?.ctaKey,
        offerId: offer.id,
        visitorTokenHash: visitorTokenHash || undefined,
        dedupeKey: sha256(`checkout:${session.id}`),
        metadata: { serverRecorded: true },
      });
      res.json({ provider: "stripe", url: session.url });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/webinars/:id/ctas/:ctaId", requireWebinarOwner, async (req, res) => {
    const deleted = await storage.deleteCtaButton(req.params.id as string, req.params.ctaId as string);
    if (!deleted) return res.status(404).json({ message: "CTA not found" });
    res.json({ success: true });
  });

  // ============ Polls Routes ============
  app.get("/api/webinars/:id/polls", requirePublishedOrOwner, async (req, res) => {
    const polls = await storage.getPollsByWebinar(req.params.id as string);
    res.json(polls);
  });

  app.post("/api/webinars/:id/polls", requireWebinarOwner, async (req, res) => {
    try {
      const data = insertPollSchema.parse({
        ...req.body,
        webinarId: req.params.id
      });
      const poll = await storage.createPoll(data);
      res.json(poll);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/webinars/:id/polls/:pollId", requireWebinarOwner, async (req, res) => {
    const deleted = await storage.deletePoll(req.params.id as string, req.params.pollId as string);
    if (!deleted) return res.status(404).json({ message: "Poll not found" });
    res.json({ success: true });
  });

  // ============ Tips Routes ============
  app.get("/api/webinars/:id/tips", requirePublishedOrOwner, async (req, res) => {
    const tipsList = await storage.getTipsByWebinar(req.params.id as string);
    res.json(tipsList);
  });

  app.post("/api/webinars/:id/tips", requireWebinarOwner, async (req, res) => {
    try {
      const data = insertTipSchema.parse({
        ...req.body,
        webinarId: req.params.id
      });
      const tip = await storage.createTip(data);
      res.json(tip);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/webinars/:id/tips/:tipId", requireWebinarOwner, async (req, res) => {
    const deleted = await storage.deleteTip(req.params.id as string, req.params.tipId as string);
    if (!deleted) return res.status(404).json({ message: "Tip not found" });
    res.json({ success: true });
  });

  // ============ Questions (Q&A) Routes ============
  app.get("/api/webinars/:id/questions", requirePublishedOrOwner, async (req, res) => {
    const questionsList = await storage.getQuestionsByWebinar(req.params.id as string);
    const webinar = await storage.getWebinar(req.params.id as string);
    const isAdministrator = webinar ? await isWebinarAdministrator(webinar.userId, req.session?.userId) : false;
    res.json(isAdministrator ? questionsList : questionsList
      .filter(question => question.isPublic)
      .map(({ askerEmail: _email, registrationId: _registrationId, answeredBy: _answeredBy, ...safe }) => safe));
  });

  app.get("/api/webinars/:id/questions/preset", requirePublishedOrOwner, async (req, res) => {
    const presetQuestions = await storage.getPresetQuestions(req.params.id as string);
    const webinar = await storage.getWebinar(req.params.id as string);
    const isAdministrator = webinar ? await isWebinarAdministrator(webinar.userId, req.session?.userId) : false;
    res.json(isAdministrator ? presetQuestions : presetQuestions
      .filter(question => question.isPublic)
      .map(({ askerEmail: _email, registrationId: _registrationId, answeredBy: _answeredBy, ...safe }) => safe));
  });

  app.post("/api/webinars/:id/questions", requirePublishedOrOwner, async (req, res) => {
    try {
      const webinar = await storage.getWebinar(req.params.id as string);
      const isAdministrator = webinar ? await isWebinarAdministrator(webinar.userId, req.session?.userId) : false;
      let viewerRegistration: Awaited<ReturnType<typeof storage.getRegistration>> | undefined;
      if (!isAdministrator) {
        const supplied = req.get("Authorization")?.replace(/^Bearer\s+/i, "") ||
          req.get("X-Watch-Token") || req.body?.watchToken;
        const token = verifyWatchToken(supplied);
        viewerRegistration = token?.webinarId === req.params.id
          ? await storage.getRegistration(token.registrationId)
          : undefined;
        if (!viewerRegistration || viewerRegistration.webinarId !== req.params.id) {
          return res.status(401).json({ message: "Invalid or expired watch token" });
        }
      }
      const input = { ...req.body };
      delete input.watchToken;
      const data = insertQuestionSchema.parse({
        ...input,
        webinarId: req.params.id,
        ...(viewerRegistration ? {
          registrationId: viewerRegistration.id,
          askerName: viewerRegistration.nickname || viewerRegistration.name,
          askerEmail: viewerRegistration.email,
          isPreset: false,
          isPublic: true,
          answer: null,
          answeredBy: null,
        } : {}),
      });
      const question = await storage.createQuestion(data);

      // 有人發問時通知主持人（含節流，避免被惡意灌爆）
      if (!data.isPreset) {
        (async () => {
          try {
            const webinar = await storage.getWebinar(req.params.id as string);
            const notify = webinar?.notifySettings as any;
            if (!webinar || !notify?.questionEmailEnabled) return;
            const lastSent = questionNotifyThrottle.get(webinar.id) || 0;
            if (Date.now() - lastSent < QUESTION_NOTIFY_COOLDOWN_MS) return;
            questionNotifyThrottle.set(webinar.id, Date.now());
            let to = (notify.notifyEmail || "").trim();
            if (!to && webinar.userId) {
              const owner = await storage.getUser(webinar.userId);
              to = owner?.email || "";
            }
            if (!to) return;
            const baseUrl = appBaseUrl();
            const controlUrl = `${baseUrl}/admin/webinar/${webinar.id}/control`;
            await sendQuestionNotificationEmail(
              to, webinar.title, data.askerName, data.question, controlUrl
            );
          } catch (err) {
            console.error("Failed to send question notification:", err);
          }
        })();
      }

      res.json(question);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/webinars/:id/questions/:questionId", requireWebinarOwner, async (req, res) => {
    try {
      const existing = (await storage.getQuestionsByWebinar(req.params.id as string))
        .find(item => item.id === req.params.questionId);
      if (!existing) return res.status(404).json({ message: "Question not found" });
      const allowed = z.object({
        answer: z.string().max(10000).nullable().optional(),
        answeredBy: z.string().max(200).nullable().optional(),
        isPublic: z.boolean().optional(),
        displayOrder: z.number().int().optional(),
      }).strict().parse(req.body);
      const question = await storage.updateQuestion(req.params.id as string, existing.id, {
        ...allowed,
        ...(allowed.answer !== undefined ? { answeredAt: allowed.answer ? new Date() : null } : {}),
      });
      res.json(question);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/webinars/:id/questions/:questionId", requireWebinarOwner, async (req, res) => {
    const existing = (await storage.getQuestionsByWebinar(req.params.id as string))
      .find(item => item.id === req.params.questionId);
    if (!existing) return res.status(404).json({ message: "Question not found" });
    const deleted = await storage.deleteQuestion(req.params.id as string, existing.id);
    if (!deleted) return res.status(404).json({ message: "Question not found" });
    res.json({ success: true });
  });

  // ============ Feedback Survey Routes ============
  app.get("/api/webinars/:id/feedback-survey", requirePublishedOrOwner, async (req, res) => {
    const survey = await storage.getFeedbackSurveyByWebinar(req.params.id as string);
    res.json(survey || null);
  });

  app.post("/api/webinars/:id/feedback-survey", requireWebinarOwner, async (req, res) => {
    try {
      const data = insertFeedbackSurveySchema.parse({
        ...req.body,
        webinarId: req.params.id
      });
      const survey = await storage.createFeedbackSurvey(data);
      res.json(survey);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/webinars/:id/feedback-survey/:surveyId", requireWebinarOwner, async (req, res) => {
    try {
      const patch = insertFeedbackSurveySchema.omit({ webinarId: true }).partial().strict().parse(req.body);
      const survey = await storage.updateFeedbackSurvey(
        req.params.id as string,
        req.params.surveyId as string,
        patch,
      );
      if (!survey) return res.status(404).json({ message: "Feedback survey not found" });
      res.json(survey);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // ============ Feedback Responses Routes ============
  app.post("/api/feedback-responses", async (req, res) => {
    try {
      const supplied = req.get("Authorization")?.replace(/^Bearer\s+/i, "") ||
        req.get("X-Watch-Token") || req.body?.watchToken;
      const token = verifyWatchToken(supplied);
      const survey = typeof req.body?.surveyId === "string"
        ? await storage.getFeedbackSurvey(req.body.surveyId)
        : undefined;
      const registration = token ? await storage.getRegistration(token.registrationId) : undefined;
      if (!survey || !survey.isActive || !registration ||
        token?.webinarId !== survey.webinarId || registration.webinarId !== survey.webinarId) {
        return res.status(401).json({ message: "Invalid or expired watch token" });
      }
      const input = { ...req.body };
      delete input.watchToken;
      const data = insertFeedbackResponseSchema.parse({ ...input, registrationId: registration.id });
      const response = await storage.createFeedbackResponse(data);
      res.json(response);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/feedback-surveys/:surveyId/responses", requireAdmin, async (req, res) => {
    const survey = await storage.getFeedbackSurvey(req.params.surveyId as string);
    if (!survey) return res.status(404).json({ message: "Feedback survey not found" });
    const webinar = await storage.getWebinar(survey.webinarId);
    if (!webinar || !(await isWebinarAdministrator(webinar.userId, req.session.userId))) {
      return res.status(404).json({ message: "Feedback survey not found" });
    }
    const responses = await storage.getFeedbackResponsesBySurvey(req.params.surveyId as string);
    res.json(responses);
  });

  // ============ Viewer Progress Routes ============
  app.get("/api/webinars/:id/progress/:sessionId", requirePublishedOrOwner, async (req, res) => {
    const progress = await storage.getViewerProgress(req.params.id as string, req.params.sessionId as string);
    res.json(progress || { lastPosition: 0, totalWatched: 0 });
  });

  app.post("/api/webinars/:id/progress", requirePublishedOrOwner, async (req, res) => {
    try {
      const data = insertViewerProgressSchema.parse({
        ...req.body,
        webinarId: req.params.id
      });
      const progress = await storage.upsertViewerProgress(data);
      res.json(progress);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // ============ Analytics Routes ============
  app.post("/api/webinars/:id/funnel-events", async (req, res) => {
    try {
      const webinarId = req.params.id as string;
      const webinar = await storage.getWebinar(webinarId);
      if (!webinar || !canViewWebinar(webinar, req.session?.userId)) {
        // Do not reveal the existence of draft webinars to public callers.
        return res.status(404).json({ message: "Webinar not found" });
      }
      const input = funnelEventInputSchema.parse(req.body);
      if (input.eventType === "purchase" || input.eventType === "refund") {
        return res.status(403).json({ message: "Payment events must be recorded by a verified server-side payment integration" });
      }

      if (input.registrationId) {
        const registration = await storage.getRegistration(input.registrationId);
        if (!registration || registration.webinarId !== webinarId) {
          return res.status(400).json({ message: "registrationId does not belong to this webinar" });
        }
      }
      if (input.eventType === "registration" && !input.registrationId) {
        return res.status(400).json({ message: "registrationId is required for registration events" });
      }
      let persistedCta: Awaited<ReturnType<typeof storage.getCtaButtonsByWebinar>>[number] | undefined;
      if (input.ctaId) {
        const ctas = await storage.getCtaButtonsByWebinar(webinarId);
        persistedCta = ctas.find(cta => cta.id === input.ctaId);
        if (!persistedCta) {
          const [liveCta] = await db.select().from(ctaButtons).where(and(
            eq(ctaButtons.id, input.ctaId),
            eq(ctaButtons.webinarId, webinarId),
            eq(ctaButtons.liveOnly, true),
            isNull(ctaButtons.archivedAt),
            sql`${ctaButtons.expiresAt} > now()`,
          )).limit(1);
          persistedCta = liveCta;
        }
        if (!persistedCta) {
          return res.status(400).json({ message: "ctaId does not belong to this webinar" });
        }
        if (input.ctaKey && input.ctaKey !== persistedCta.ctaKey) {
          return res.status(400).json({ message: "ctaKey does not match the persisted CTA" });
        }
      } else if (input.ctaKey && !verifyLiveCtaKey(
        input.ctaKey,
        webinarId,
        process.env.SESSION_SECRET || "",
      )) {
        return res.status(400).json({ message: "Invalid, expired, or cross-webinar live CTA key" });
      }

      const visitorTokenHash = input.visitorToken ? sha256(input.visitorToken) : undefined;
      // Registration events are authoritative and created in the registration transaction.
      // Normalizing their key prevents a client retry from inflating registrations.
      const dedupeKey = funnelDedupeKey(input.eventType, input.dedupeKey, input.registrationId);
      const result = await storage.createFunnelEvent({
        webinarId,
        eventType: input.eventType,
        registrationId: input.registrationId,
        sessionId: input.sessionId,
        ctaId: input.ctaId,
        ctaKey: persistedCta?.ctaKey ?? input.ctaKey,
        visitorTokenHash,
        positionSeconds: input.positionSeconds,
        value: input.value === undefined ? undefined : input.value.toFixed(2),
        currency: input.currency,
        dedupeKey,
        metadata: safeRequestMetadata(input.metadata, {
          referrer: req.get("referer"),
          userAgent: req.get("user-agent"),
          ip: req.ip || req.socket.remoteAddress,
          hashSalt: process.env.SESSION_SECRET || "funnel-context",
        }),
      });
      res.status(result.deduplicated ? 200 : 202).json({
        accepted: true,
        deduplicated: result.deduplicated,
        eventId: result.event.id,
        occurredAt: result.event.occurredAt,
      });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/webinars/:id/funnel-analytics", requireWebinarOwner, async (req, res) => {
    try {
      const webinarId = req.params.id as string;
      const webinar = await storage.getWebinar(webinarId);
      if (!webinar) return res.status(404).json({ message: "Webinar not found" });
      if (await denyAdvancedTrialOnly(res, webinar.userId)) return;
      const parseDate = (value: unknown, endOfDay = false): Date | undefined => {
        if (typeof value !== "string" || !value) return undefined;
        const date = new Date(value);
        if (!Number.isFinite(date.getTime())) throw new Error("Invalid analytics date range");
        if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value)) date.setUTCHours(23, 59, 59, 999);
        return date;
      };
      const from = parseDate(req.query.from);
      const to = parseDate(req.query.to, true);
      if (from && to && from > to) return res.status(400).json({ message: "from must be before to" });
      const events = await storage.getFunnelEvents(webinarId, from, to);
      res.json({
        webinarId,
        range: { from: from?.toISOString() ?? null, to: to?.toISOString() ?? null },
        ...aggregateFunnelEvents(events, webinar.videoDuration || 0),
      });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/webinars/:id/analytics", requireWebinarOwner, async (req, res) => {
    const webinarId = req.params.id as string;
    const webinar = await storage.getWebinar(webinarId);
    if (!webinar) {
      return res.status(404).json({ message: "Webinar not found" });
    }
    if (await denyAdvancedTrialOnly(res, webinar.userId)) return;

    const analytics = await storage.getWebinarAnalytics(webinarId);
    const registrations = await storage.getRegistrationsByWebinar(webinarId);
    
    // Calculate summary stats
    const totalRegistrations = registrations.length;
    const attended = registrations.filter(r => r.attended).length;
    const attendanceRate = totalRegistrations > 0 ? (attended / totalRegistrations * 100) : 0;
    const totalWatchTime = registrations.reduce((sum, r) => sum + (r.watchDuration || 0), 0);
    const avgWatchTime = attended > 0 ? Math.round(totalWatchTime / attended) : 0;

    res.json({
      webinar,
      summary: {
        totalRegistrations,
        attended,
        attendanceRate: Math.round(attendanceRate * 10) / 10,
        avgWatchTime,
        videoDuration: webinar.videoDuration || 0,
      },
      analytics,
      registrations,
    });
  });

  // ============ Webinar Sessions Routes ============
  app.get("/api/webinars/:id/sessions", requirePublishedOrOwner, async (req, res) => {
    const sessions = await storage.getWebinarSessions(req.params.id as string);
    res.json(sessions);
  });

  app.post("/api/webinars/:id/sessions", requireWebinarOwner, async (req, res) => {
    try {
      const body = {
        ...req.body,
        webinarId: req.params.id,
        scheduledStart: new Date(req.body.scheduledStart),
      };
      if (req.body.scheduledEnd) {
        body.scheduledEnd = new Date(req.body.scheduledEnd);
      }
      const data = insertWebinarSessionSchema.parse(body);
      const session = await storage.createWebinarSession(data);
      res.json(session);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/webinars/:id/sessions/:sessionId", requireWebinarOwner, async (req, res) => {
    try {
      const deleted = await storage.deleteWebinarSession(req.params.id as string, req.params.sessionId as string);
      if (!deleted) return res.status(404).json({ message: "Session not found" });
      res.json({ success: true });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // ============ Webinar Duplication ============
  app.post("/api/webinars/:id/duplicate", requireWebinarOwner, withMediaReferenceLock(async (req, res) => {
    try {
      const sourceWebinar = await storage.getWebinar(req.params.id as string);
      if (!sourceWebinar) {
        return res.status(404).json({ message: "Webinar not found" });
      }
      await verifyReferencedMediaUrls(sourceWebinar);

      const newWebinar = await storage.createWebinar({
        title: `${sourceWebinar.title} (副本)`,
        description: sourceWebinar.description || undefined,
        vimeoUrl: sourceWebinar.vimeoUrl,
        videoProvider: sourceWebinar.videoProvider,
        videoAssetId: sourceWebinar.videoAssetId,
        coverImage: sourceWebinar.coverImage || undefined,
        startTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        videoDuration: sourceWebinar.videoDuration || undefined,
        scheduleMode: sourceWebinar.scheduleMode as any,
        recurringSchedule: sourceWebinar.recurringSchedule as any,
        timezone: sourceWebinar.timezone || undefined,
        brandSettings: sourceWebinar.brandSettings as any,
        replayEnabled: sourceWebinar.replayEnabled ?? undefined,
        replayAvailableHours: sourceWebinar.replayAvailableHours ?? undefined,
        emailSettings: sourceWebinar.emailSettings as any,
        aiSettings: sourceWebinar.aiSettings as any,
        userId: sourceWebinar.userId || req.session.userId,
      });

      const [sourceFakeUsers, sourceMessages, sourceCtas, sourcePolls, sourceTips, sourceOffers, sourceDocuments] = await Promise.all([
        storage.getFakeUsersByWebinar(sourceWebinar.id),
        storage.getScheduledMessagesByWebinar(sourceWebinar.id),
        storage.getCtaButtonsByWebinar(sourceWebinar.id),
        storage.getPollsByWebinar(sourceWebinar.id),
        storage.getTipsByWebinar(sourceWebinar.id),
        storage.getWebinarOffers(sourceWebinar.id),
        storage.getWebinarDocuments(sourceWebinar.id),
      ]);

      const fakeUserIdMap = new Map<string, string>();
      for (const fu of sourceFakeUsers) {
        await verifyReferencedMediaUrls(fu.avatar);
        const newFu = await storage.createFakeUser({
          webinarId: newWebinar.id,
          name: fu.name,
          avatar: fu.avatar || undefined,
        });
        fakeUserIdMap.set(fu.id, newFu.id);
      }

      for (const msg of sourceMessages) {
        await storage.createScheduledMessage({
          webinarId: newWebinar.id,
          fakeUserId: fakeUserIdMap.get(msg.fakeUserId || "") || msg.fakeUserId || "",
          message: msg.message,
          triggerTime: msg.triggerTime,
        });
      }

      const offerIdMap = new Map<string, string>();
      for (const offer of sourceOffers) {
        if (offer.paymentProvider !== "ecpay" || !offer.ecpayItemName || !offer.ecpayAmountTwd) continue;
        const copied = await storage.createWebinarOffer({
          userId: newWebinar.userId!,
          webinarId: newWebinar.id,
          paymentProvider: "ecpay",
          ecpayItemName: offer.ecpayItemName,
          ecpayAmountTwd: offer.ecpayAmountTwd,
          checkoutMode: "payment",
        });
        offerIdMap.set(offer.id, copied.id);
      }
      for (const cta of sourceCtas) {
        await storage.createCtaButton({
          webinarId: newWebinar.id,
          text: cta.text,
          url: cta.url,
          offerId: cta.offerId ? offerIdMap.get(cta.offerId) : undefined,
          salesPageId: cta.salesPageId,
          startTime: cta.startTime,
          endTime: cta.endTime ?? undefined,
          style: cta.style || undefined,
        });
      }

      for (const poll of sourcePolls) {
        await storage.createPoll({
          webinarId: newWebinar.id,
          question: poll.question,
          options: poll.options as string[],
          triggerTime: poll.triggerTime,
          duration: poll.duration ?? undefined,
        });
      }

      for (const tip of sourceTips) {
        await storage.createTip({
          webinarId: newWebinar.id,
          title: tip.title,
          content: tip.content,
          triggerTime: tip.triggerTime,
          duration: tip.duration ?? undefined,
          icon: tip.icon ?? undefined,
        });
      }

      // The AI assistant answers from these documents; without them a copied
      // webinar's assistant would only ever give the fallback reply.
      for (const document of sourceDocuments) {
        await storage.createWebinarDocument({
          webinarId: newWebinar.id,
          title: document.title,
          content: document.content,
          sourceType: document.sourceType,
          sourceUrl: document.sourceUrl ?? undefined,
        });
      }

      res.json(newWebinar);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }));

  // ============ Public: Available Sessions ============
  app.get("/api/webinars/:id/registration-count", requirePublishedOrOwner, async (req, res) => {
    try {
      const regs = await storage.getRegistrationsByWebinar(req.params.id as string);
      res.json({ count: regs.length });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/webinars/:id/available-sessions", requirePublishedOrOwner, async (req, res) => {
    try {
      const webinar = await storage.getWebinar(req.params.id as string);
      if (!webinar) return res.status(404).json({ message: "Webinar not found" });
      try {
        scheduleDateBounds(webinar.scheduleMode);
      } catch (error: any) {
        return res.status(400).json({ message: error.message });
      }

      const allSessions = await storage.getWebinarSessions(webinar.id);
      const availability = getAvailableSessions(webinar, allSessions);
      if (availability.mode === "justInTime" && process.env.SESSION_SECRET) {
        return res.json({
          ...availability,
          jitSelectionToken: createJitSelectionToken(webinar.id, availability.sessions[0].scheduledStart),
        });
      }
      return res.json(availability);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/webinars/:id/watch-state", requirePublishedOrOwner, async (req, res) => {
    const token = verifyWatchToken(req.query.watchToken);
    if (!token || token.webinarId !== req.params.id) {
      return res.status(401).json({ message: "Invalid or expired watch token" });
    }
    const registration = await storage.getRegistration(token.registrationId);
    if (!registration || registration.webinarId !== req.params.id) {
      return res.status(401).json({ message: "Invalid or expired watch token" });
    }
    const webinar = await storage.getWebinar(req.params.id as string);
    if (!webinar) return res.status(404).json({ message: "Webinar not found" });
    const eligibility = webinarWatchEligibility(webinar, registration);
    const { selectedSession, replayEndsAt, canWatch } = eligibility;
    let playback: Record<string, unknown> | undefined;
    if (canWatch) {
      if (webinar.videoProvider === "bunny") {
        if (!webinar.videoAssetId || !webinar.userId) return res.status(409).json({ message: "Webinar video is unavailable" });
        const asset = await resolveReadyOwnedVideoAsset(webinar.userId, webinar.videoAssetId);
        if (!asset?.providerId) return res.status(409).json({ message: "Webinar video is unavailable" });
        try {
          playback = getBunnyMediaClient().playback(asset.providerId);
        } catch {
          return res.status(503).json({
            message: "Secure video playback is unavailable",
            code: "MEDIA_PLAYBACK_NOT_CONFIGURED",
          });
        }
      } else {
        playback = { provider: "vimeo", url: webinar.vimeoUrl };
      }
    }
    res.json({
      registrationId: registration.id,
      selectedSession,
      canWatch,
      waitUntil: canWatch ? null : selectedSession,
      liveEndsAt: eligibility.liveEndsAt,
      replayEndsAt,
      mode: selectedSession ? "scheduled" : "onDemand",
      ...(canWatch ? {
        playback,
        ...(webinar.videoProvider === "vimeo" ? { vimeoUrl: webinar.vimeoUrl } : {}),
      } : {}),
    });
  });

  // ============ Recurring Schedule Generation ============
  app.post("/api/webinars/:id/generate-sessions", requireWebinarOwner, async (req, res) => {
    try {
      const webinar = await storage.getWebinar(req.params.id as string);
      if (!webinar) {
        return res.status(404).json({ message: "Webinar not found" });
      }

      const schedule = webinar.recurringSchedule as any;
      if (!schedule?.enabled || !schedule.days?.length || !schedule.times?.length) {
        return res.status(400).json({ message: "No recurring schedule configured" });
      }
      try {
        scheduleDateBounds(webinar.scheduleMode);
      } catch (error: any) {
        return res.status(400).json({ message: error.message });
      }

      const daysToGenerate = Math.min(366, Math.max(1, Math.floor(Number(req.body.days) || 30)));
      const now = new Date();
      const sessions: any[] = [];

      const existingSessions = await storage.getWebinarSessions(webinar.id);
      const existingKeys = new Set(
        existingSessions.map(s => `${new Date(s.scheduledStart).getTime()}`)
      );

      const generated = generateRecurringSessions(webinar, now, daysToGenerate, 2000);
      for (const slot of generated) {
        const key = `${slot.scheduledStart.getTime()}`;
        if (existingKeys.has(key)) continue;
        const session = await storage.createWebinarSession({
          webinarId: webinar.id,
          scheduledStart: slot.scheduledStart,
          status: "scheduled",
        });
        sessions.push(session);
        existingKeys.add(key);
      }

      res.json({ generated: sessions.length, sessions });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Start email scheduler
  startScheduler();

  // ============ Mark Attendance ============
  app.post("/api/registrations/:id/attend", async (req, res) => {
    try {
      const authorized = await verifiedRegistrationCapability(req);
      if (!authorized) return res.status(401).json({ message: "Invalid or expired watch token" });
      const transitioned = await db.transaction(async (tx) => {
        const [changed] = await tx.update(registrations).set({
          attended: true,
          attendedAt: new Date(),
        }).where(and(eq(registrations.id, authorized.id), sql`${registrations.attended} IS NOT TRUE`)).returning();
        if (!changed) return undefined;
        const hooksForEvent = await tx.select().from(webhooks).where(and(
          eq(webhooks.webinarId, authorized.webinarId),
          eq(webhooks.eventType, "attendance"),
          eq(webhooks.enabled, true),
        ));
        for (const hook of hooksForEvent) {
          await tx.insert(webhookDeliveries).values({
            webhookId: hook.id,
            eventType: "attendance",
            eventKey: `attendance:${authorized.id}`,
            payload: {
              event: "attendance",
              data: { registrationId: authorized.id, attendedAt: changed.attendedAt },
              timestamp: new Date().toISOString(),
            },
          }).onConflictDoNothing();
        }
        return changed;
      });
      const registration = transitioned || authorized;
      res.json({ attended: !!registration?.attended, attendedAt: registration?.attendedAt || null });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.post("/api/registrations/:id/leave", async (req, res) => {
    try {
      const authorized = await verifiedRegistrationCapability(req);
      if (!authorized) return res.status(401).json({ message: "Invalid or expired watch token" });
      const requested = Number(req.body?.watchDuration);
      const elapsed = authorized.attendedAt
        ? Math.max(0, Math.floor((Date.now() - new Date(authorized.attendedAt).getTime()) / 1000))
        : 0;
      const watchDuration = Number.isFinite(requested)
        ? Math.min(elapsed, Math.max(0, Math.floor(requested)))
        : elapsed;
      const webinar = await storage.getWebinar(authorized.webinarId);
      if (!webinar) return res.status(404).json({ message: "Webinar not found" });
      const transitioned = await db.transaction(async (tx) => {
        const [current] = await tx.select().from(registrations)
          .where(eq(registrations.id, authorized.id)).for("update");
        if (!current) return undefined;
        const previousDuration = current.watchDuration || 0;
        const nextDuration = Math.max(previousDuration, watchDuration);
        const [changed] = await tx.update(registrations).set({
          leftAt: new Date(),
          watchDuration: nextDuration,
        }).where(eq(registrations.id, authorized.id)).returning();
        if (!changed) return undefined;
        const completionThreshold = webinar.videoDuration
          ? Math.max(1, Math.floor(webinar.videoDuration * 0.95))
          : Number.POSITIVE_INFINITY;
        if (previousDuration >= completionThreshold || nextDuration < completionThreshold) {
          return changed;
        }
        const hooksForEvent = await tx.select().from(webhooks).where(and(
          eq(webhooks.webinarId, authorized.webinarId),
          eq(webhooks.eventType, "completion"),
          eq(webhooks.enabled, true),
        ));
        for (const hook of hooksForEvent) {
          await tx.insert(webhookDeliveries).values({
            webhookId: hook.id,
            eventType: "completion",
            eventKey: `completion:${authorized.id}`,
            payload: {
              event: "completion",
              data: { registrationId: authorized.id, leftAt: changed.leftAt, watchDuration: changed.watchDuration },
              timestamp: new Date().toISOString(),
            },
          }).onConflictDoNothing();
        }
        return changed;
      });
      const registration = transitioned || authorized;
      res.json({ leftAt: registration?.leftAt || null, watchDuration: registration?.watchDuration || 0 });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // ============ Webhooks ============
  async function dispatchWebhook(webinarId: string, eventType: string, payload: any) {
    if (!isAcceptingWork()) return;
    try {
      const hooks = await storage.getWebhooksByEvent(webinarId, eventType);
      for (const hook of hooks) {
        const envelope = { event: eventType, data: payload, timestamp: new Date().toISOString() };
        const body = JSON.stringify(envelope);
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (hook.secret) {
          const signature = crypto.createHmac("sha256", hook.secret).update(body).digest("hex");
          headers["X-Webhook-Signature"] = signature;
        }
        const leaseToken = crypto.randomBytes(18).toString("base64url");
        const [delivery] = await db.insert(webhookDeliveries).values({
          webhookId: hook.id,
          eventType,
           eventKey: typeof payload?.eventId === "string" ? payload.eventId : null,
          payload: envelope,
          status: "processing",
          attemptCount: 1,
          leaseToken,
          nextAttemptAt: new Date(Date.now() + WEBHOOK_LEASE_MS),
         }).onConflictDoNothing().returning({ id: webhookDeliveries.id });
         if (!delivery) continue;
        void trackOperation(deliverWebhook(hook.targetUrl, { headers, body }).then(async () => {
          await db.update(webhookDeliveries).set({
            status: "delivered", deliveredAt: new Date(), lastError: null, leaseToken: null,
          }).where(and(eq(webhookDeliveries.id, delivery.id), eq(webhookDeliveries.leaseToken, leaseToken)));
        }).catch(async (err) => {
          await db.update(webhookDeliveries).set({
            status: "retry", leaseToken: null,
            nextAttemptAt: new Date(Date.now() + 60_000),
            lastError: String(err?.message || err).slice(0, 2000),
          }).where(and(eq(webhookDeliveries.id, delivery.id), eq(webhookDeliveries.leaseToken, leaseToken)));
          console.error(`Webhook delivery failed for ${hook.id}:`, err.message);
        }));
      }
    } catch (err) {
      console.error("Webhook dispatch error:", err);
    }
  }

  async function retryWebhookDeliveries() {
    if (!isAcceptingWork()) return;
    schedulerAttempt("webhook_delivery");
    const claimNow = new Date();
    const due = await db.select().from(webhookDeliveries).where(and(
      lte(webhookDeliveries.nextAttemptAt, claimNow),
      or(
        eq(webhookDeliveries.status, "pending"),
        eq(webhookDeliveries.status, "retry"),
        eq(webhookDeliveries.status, "processing"),
      ),
    )).limit(50);
    for (const delivery of due) {
      if (!isAcceptingWork()) return;
      const leaseToken = crypto.randomBytes(18).toString("base64url");
      const claimed = await db.update(webhookDeliveries).set({
        status: "processing",
        nextAttemptAt: new Date(Date.now() + WEBHOOK_LEASE_MS),
        leaseToken,
        attemptCount: sql`${webhookDeliveries.attemptCount} + 1`,
      }).where(and(
        eq(webhookDeliveries.id, delivery.id),
        eq(webhookDeliveries.attemptCount, delivery.attemptCount),
        lte(webhookDeliveries.nextAttemptAt, claimNow),
        or(
          eq(webhookDeliveries.status, "pending"),
          eq(webhookDeliveries.status, "retry"),
          eq(webhookDeliveries.status, "processing"),
        ),
      )).returning({ id: webhookDeliveries.id, attemptCount: webhookDeliveries.attemptCount });
      if (!claimed[0]) continue;
      const [hook] = await db.select().from(webhooks).where(eq(webhooks.id, delivery.webhookId)).limit(1);
      if (!hook?.enabled) {
        await db.update(webhookDeliveries).set({ status: "failed", lastError: "Webhook disabled or deleted" })
          .where(and(eq(webhookDeliveries.id, delivery.id), eq(webhookDeliveries.leaseToken, leaseToken)));
        continue;
      }
      const body = JSON.stringify(delivery.payload);
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (hook.secret) {
        headers["X-Webhook-Signature"] = crypto.createHmac("sha256", hook.secret).update(body).digest("hex");
      }
      try {
        await deliverWebhook(hook.targetUrl, { headers, body });
        await db.update(webhookDeliveries).set({
          status: "delivered", deliveredAt: new Date(),
          lastError: null, leaseToken: null,
        }).where(and(eq(webhookDeliveries.id, delivery.id), eq(webhookDeliveries.leaseToken, leaseToken)));
      } catch (error) {
        const attempts = claimed[0].attemptCount;
        await db.update(webhookDeliveries).set({
          status: attempts >= 8 ? "failed" : "retry",
          leaseToken: null,
          nextAttemptAt: new Date(Date.now() + Math.min(3600, 2 ** attempts * 30) * 1000),
          lastError: String(error instanceof Error ? error.message : error).slice(0, 2000),
        }).where(and(eq(webhookDeliveries.id, delivery.id), eq(webhookDeliveries.leaseToken, leaseToken)));
      }
    }
    schedulerSuccess("webhook_delivery");
  }

  let webhookRetryTimer: NodeJS.Timeout | undefined;
  if (process.env.NODE_ENV !== "test") {
    const runWebhookRetry = () => {
      const operation = trackOperation(retryWebhookDeliveries());
      void operation.catch(error => {
        schedulerFailure("webhook_delivery");
        console.error("Webhook retry sweep failed:", error);
      });
    };
    runWebhookRetry();
    webhookRetryTimer = setInterval(runWebhookRetry, 60_000);
    registerStopper(() => {
      if (webhookRetryTimer) clearInterval(webhookRetryTimer);
    });
  }

  app.get("/api/webinars/:id/webhooks", requireWebinarOwner, async (req, res) => {
    const hooks = await storage.getWebhooksByWebinar(req.params.id as string);
    res.json(hooks);
  });

  app.post("/api/webinars/:id/webhooks", requireWebinarOwner, async (req, res) => {
    try {
      const data = insertWebhookSchema.parse({ ...req.body, webinarId: req.params.id });
      await assertSafeWebhookUrl(data.targetUrl);
      const hook = await storage.createWebhook(data);
      res.json(hook);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/webinars/:id/webhooks/:hookId", requireWebinarOwner, async (req, res) => {
    try {
      const existing = (await storage.getWebhooksByWebinar(req.params.id as string))
        .find(item => item.id === req.params.hookId);
      if (!existing) return res.status(404).json({ message: "Webhook not found" });
      const update = z.object({
        eventType: z.enum(["registration", "completion", "attendance"]).optional(),
        targetUrl: z.string().url().optional(),
        secret: z.string().max(512).nullable().optional(),
        enabled: z.boolean().optional(),
      }).strict().parse(req.body);
      if (update.targetUrl) await assertSafeWebhookUrl(update.targetUrl);
      const hook = await storage.updateWebhook(req.params.id as string, existing.id, update);
      res.json(hook);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/webinars/:id/webhooks/:hookId", requireWebinarOwner, async (req, res) => {
    const existing = (await storage.getWebhooksByWebinar(req.params.id as string))
      .find(item => item.id === req.params.hookId);
    if (!existing) return res.status(404).json({ message: "Webhook not found" });
    const deleted = await storage.deleteWebhook(req.params.id as string, existing.id);
    if (!deleted) return res.status(404).json({ message: "Webhook not found" });
    res.json({ success: true });
  });

  registerAiKnowledgeRoutes(app, requireWebinarOwner);
  registerAiManagementRoutes(app, requireWebinarOwner);
  registerSalesScriptRoutes(app, requireWebinarOwner);
  registerAdminManagementRoutes(app, revokeUserSessions);
  registerCourseMarketplaceRoutes(app);

  // ============ AI 一鍵生成（互動 / 電子報 / 貼文）============
  // 共用：預扣點數（reserve）。回 { ok, remaining } 或 { ok:false, reason }
  async function reserveGenerationPoints(webinarId: string): Promise<{ ok: true; reservationId: string | null; trialReservationIds: string[] } | { ok: false; status: number; message: string }> {
    const webinar = await storage.getWebinar(webinarId);
    if (!webinar) return { ok: false, status: 404, message: "找不到直播間" };
    const ownerId = webinar.userId || null;
    const owner = ownerId ? await storage.getUser(ownerId) : undefined;
    const unlimited = !!owner && (owner.isSuperAdmin || owner.subscriptionPlan === "enterprise");
    if (unlimited || !ownerId) return { ok: true, reservationId: null, trialReservationIds: [] };
    const trial = owner?.subscriptionPlan === "free" ? await getActiveNoCardTrial(ownerId) : null;
    if (trial) {
      const reservation = await reserveTrialAiCall(ownerId);
      if (!reservation) {
        return { ok: false, status: 402, message: `試用期 AI 額度已用完（共 ${NO_CARD_TRIAL_AI_CALL_LIMIT} 次）` };
      }
      return { ok: true, reservationId: null, trialReservationIds: reservation.reservationIds };
    }
    const reservation = await storage.reserveAiCredits(ownerId, AI_POINTS_PER_GENERATION);
    if (!reservation) {
      return { ok: false, status: 402, message: `AI 點數不足，本次生成需要 ${AI_POINTS_PER_GENERATION} 點，請先儲值` };
    }
    return { ok: true, reservationId: reservation.reservationId, trialReservationIds: [] };
  }

  // 1. 一鍵生成互動（假人聊天 / CTA / 投票 / 提示卡，含時間點）
  app.post("/api/webinars/:id/ai/generate-interactions", requireWebinarOwner, async (req, res) => {
    const webinarId = req.params.id as string;
    const reserve = await reserveGenerationPoints(webinarId);
    if (!reserve.ok) return res.status(reserve.status).json({ message: reserve.message });
    try {
      const webinar = await storage.getWebinar(webinarId);
      if (!webinar) {
        if (reserve.reservationId) await storage.refundAiCreditReservation(reserve.reservationId);
        await Promise.all(reserve.trialReservationIds.map((reservationId) => refundTrialAiCall(reservationId)));
        return res.status(404).json({ message: "找不到直播間" });
      }
      const goal = typeof req.body?.goal === "string" ? req.body.goal : "";
      const replace = req.body?.replace === true;
      // 逐字稿來源：優先用請求帶的 transcript（含時間軸），否則用已存知識文檔
      let transcript = typeof req.body?.transcript === "string" ? req.body.transcript : "";
      if (!transcript.trim()) transcript = await getWebinarKnowledge(webinarId);

      const result = await generateInteractions(webinar.title, transcript, webinar.videoDuration || 0, goal);
      if (!result) {
        if (reserve.reservationId) await storage.refundAiCreditReservation(reserve.reservationId);
        await Promise.all(reserve.trialReservationIds.map((reservationId) => refundTrialAiCall(reservationId)));
        return res.status(502).json({ message: "AI 生成失敗，請稍後再試（未扣點）" });
      }

      const counts = await storage.persistGeneratedInteractions({
        reservationId: reserve.reservationId,
        userId: webinar.userId || req.session.userId!,
        webinarId,
        replace,
        requestText: JSON.stringify({ goal, transcript }),
        result,
      });
      await Promise.all(reserve.trialReservationIds.map((reservationId) => completeTrialAiCall(reservationId)));
      res.json({
        success: true,
        counts,
      });
    } catch (error: any) {
      if (reserve.reservationId) await storage.refundAiCreditReservation(reserve.reservationId);
      await Promise.all(reserve.trialReservationIds.map((reservationId) => refundTrialAiCall(reservationId)));
      res.status(500).json({ message: error.message || "生成失敗（已退點）" });
    }
  });

  // 2. 生成銷售追蹤電子報序列
  app.post("/api/webinars/:id/ai/generate-email-sequence", requireWebinarOwner, async (req, res) => {
    const webinarId = req.params.id as string;
    const reserve = await reserveGenerationPoints(webinarId);
    if (!reserve.ok) return res.status(reserve.status).json({ message: reserve.message });
    try {
      const webinar = await storage.getWebinar(webinarId);
      if (!webinar) {
        if (reserve.reservationId) await storage.refundAiCreditReservation(reserve.reservationId);
        await Promise.all(reserve.trialReservationIds.map((reservationId) => refundTrialAiCall(reservationId)));
        return res.status(404).json({ message: "找不到直播間" });
      }
      const goal = typeof req.body?.goal === "string" ? req.body.goal : "";
      const replace = req.body?.replace === true;
      const knowledge = await getWebinarKnowledge(webinarId);
      const emails = await generateEmailSequence(webinar.title, goal, knowledge);
      if (!emails || emails.length === 0) {
        if (reserve.reservationId) await storage.refundAiCreditReservation(reserve.reservationId);
        await Promise.all(reserve.trialReservationIds.map((reservationId) => refundTrialAiCall(reservationId)));
        return res.status(502).json({ message: "AI 生成失敗，請稍後再試（未扣點）" });
      }
      const created = await storage.persistGeneratedEmailSequences({
        reservationId: reserve.reservationId,
        userId: webinar.userId || req.session.userId!,
        webinarId,
        replace,
        requestText: JSON.stringify({ goal, knowledge }),
        emails,
      });
      await Promise.all(reserve.trialReservationIds.map((reservationId) => completeTrialAiCall(reservationId)));
      res.json({ success: true, count: created.length, sequences: created });
    } catch (error: any) {
      if (reserve.reservationId) await storage.refundAiCreditReservation(reserve.reservationId);
      await Promise.all(reserve.trialReservationIds.map((reservationId) => refundTrialAiCall(reservationId)));
      res.status(500).json({ message: error.message || "生成失敗（已退點）" });
    }
  });

  // 3. 生成排程社群貼文草稿
  app.post("/api/webinars/:id/ai/generate-social-posts", requireWebinarOwner, async (req, res) => {
    const webinarId = req.params.id as string;
    const reserve = await reserveGenerationPoints(webinarId);
    if (!reserve.ok) return res.status(reserve.status).json({ message: reserve.message });
    try {
      const webinar = await storage.getWebinar(webinarId);
      if (!webinar) {
        if (reserve.reservationId) await storage.refundAiCreditReservation(reserve.reservationId);
        await Promise.all(reserve.trialReservationIds.map((reservationId) => refundTrialAiCall(reservationId)));
        return res.status(404).json({ message: "找不到直播間" });
      }
      const goal = typeof req.body?.goal === "string" ? req.body.goal : "";
      const replace = req.body?.replace === true;
      const knowledge = await getWebinarKnowledge(webinarId);
      const posts = await generateSocialPosts(webinar.title, goal, knowledge);
      if (!posts || posts.length === 0) {
        if (reserve.reservationId) await storage.refundAiCreditReservation(reserve.reservationId);
        await Promise.all(reserve.trialReservationIds.map((reservationId) => refundTrialAiCall(reservationId)));
        return res.status(502).json({ message: "AI 生成失敗，請稍後再試（未扣點）" });
      }
      const created = await storage.persistGeneratedSocialPosts({
        reservationId: reserve.reservationId,
        userId: webinar.userId || req.session.userId!,
        webinarId,
        replace,
        requestText: JSON.stringify({ goal, knowledge }),
        posts,
      });
      await Promise.all(reserve.trialReservationIds.map((reservationId) => completeTrialAiCall(reservationId)));
      res.json({ success: true, count: created.length, posts: created });
    } catch (error: any) {
        if (reserve.reservationId) await storage.refundAiCreditReservation(reserve.reservationId);
        await Promise.all(reserve.trialReservationIds.map((reservationId) => refundTrialAiCall(reservationId)));
      res.status(500).json({ message: error.message || "生成失敗（已退點）" });
    }
  });

  // ============ Email Sequences CRUD ============
  app.get("/api/webinars/:id/email-sequences", requireWebinarOwner, async (req, res) => {
    const seqs = await storage.getEmailSequences(req.params.id as string);
    res.json(seqs);
  });

  app.post("/api/webinars/:id/email-sequences", requireWebinarOwner, async (req, res) => {
    try {
      const data = insertEmailSequenceSchema.parse({ ...req.body, webinarId: req.params.id });
      const seq = await storage.createEmailSequence(data);
      res.json(seq);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/webinars/:id/email-sequences/:seqId", requireWebinarOwner, async (req, res) => {
    try {
      const { id, webinarId, createdAt, ...patch } = req.body || {};
      const seq = await storage.updateEmailSequence(req.params.id as string, req.params.seqId as string, patch);
      if (!seq) return res.status(404).json({ message: "找不到郵件" });
      res.json(seq);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/webinars/:id/email-sequences/:seqId", requireWebinarOwner, async (req, res) => {
    await storage.deleteEmailSequence(req.params.id as string, req.params.seqId as string);
    res.json({ success: true });
  });

  // ============ Social Posts CRUD ============
  app.get("/api/webinars/:id/social-posts", requireWebinarOwner, async (req, res) => {
    const posts = await storage.getSocialPosts(req.params.id as string);
    res.json(posts);
  });

  app.post("/api/webinars/:id/social-posts", requireWebinarOwner, async (req, res) => {
    try {
      const data = insertSocialPostSchema.parse({ ...req.body, webinarId: req.params.id });
      const post = await storage.createSocialPost(data);
      res.json(post);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/webinars/:id/social-posts/:postId", requireWebinarOwner, async (req, res) => {
    try {
      const { id, webinarId, createdAt, ...patch } = req.body || {};
      const post = await storage.updateSocialPost(req.params.id as string, req.params.postId as string, patch);
      if (!post) return res.status(404).json({ message: "找不到貼文" });
      res.json(post);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/webinars/:id/social-posts/:postId", requireWebinarOwner, async (req, res) => {
    await storage.deleteSocialPost(req.params.id as string, req.params.postId as string);
    res.json({ success: true });
  });

  // ============ CSV Export ============
  app.get("/api/webinars/:id/registrations/export", requireWebinarOwner, async (req, res) => {
    try {
      const regs = await storage.getRegistrationsByWebinar(req.params.id as string);
      const webinar = await storage.getWebinar(req.params.id as string);
      const customFields = (webinar?.customFields as Array<{ id: string; label: string }>) || [];
      const headers = ["Name", "Email", "Phone", "Tags", "Registered At", "Attended", "Attended At", "Left At", "Watch Duration (s)", "UTM Source", "UTM Medium", "UTM Campaign", "UTM Term", "UTM Content", "Landing URL", ...customFields.map(f => f.label)];
      const rows = regs.map((r: any) => [
        r.name, r.email, r.phone || "", (r.tags || []).join("; "),
        r.registeredAt || "", r.attended ? "Yes" : "No",
        r.attendedAt || "", r.leftAt || "", r.watchDuration || "",
        r.utmSource || "", r.utmMedium || "", r.utmCampaign || "",
        r.utmTerm || "", r.utmContent || "", r.landingUrl || "",
        ...customFields.map(f => (r.customFieldData || {})[f.id] || "")
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(","));
      const csv = [headers.join(","), ...rows].join("\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename=registrations-${req.params.id}.csv`);
      res.send("\uFEFF" + csv);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  return httpServer;
}
