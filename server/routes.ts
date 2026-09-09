import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import multer from "multer";
import path from "path";
import fs from "fs";
import { z } from "zod";
import { storage } from "./storage";
import { sendQuestionNotificationEmail } from "./gmail";
import { createEmailRemindersForRegistration, startEmailScheduler } from "./email-scheduler";
import { generateRecurringSessions, getAvailableSessions, normalizeSelectedSession, scheduleDateBounds } from "./webinarScheduling";
import { createJitSelectionToken, createWatchToken, verifyJitSelectionToken, verifyWatchToken, watchTokenExpiry } from "./watchTokens";
import crypto from "crypto";
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
  insertWebinarDocumentSchema,
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
  ecpayConnections,
  webinarPayments,
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
import { and, eq, sql } from "drizzle-orm";
import { generateInteractions, generateEmailSequence, generateSocialPosts, generateWebinarPlan, getWebinarKnowledge } from "./aiGenerator";

import bcrypt from "bcryptjs";
import { getUncachableStripeClient, getStripePublishableKey } from "./stripeClient";
import { looksLikeQuestion, answerViewerQuestion } from "./aiAssistant";
import {
  ADDON_LOOKUP_KEY,
  ANNUAL_ADDON_LOOKUP_KEY,
  SUBSCRIPTION_PLANS,
  planLookupKey,
  type BillingInterval,
  getMonthlyRegistrantLimit,
  getApprovedPriceIds,
  refreshSubscriptionEntitlement,
  type SubscriptionPlanKey,
} from "./subscriptionEntitlements";
import { isPaidBillableSubscriptionInvoice, reconcileCurrentSubscriptionCredit } from "./subscriptionCreditGrants";
import { canViewWebinar } from "./webinarAccess";
import { appBaseUrl, sendTransactionalMail } from "./mail";
import { createRawToken, hashToken } from "./security";
import { postgresRateLimit } from "./rateLimit";
import { persistProductionError } from "./errorReporter";
import { createLiveCtaKey, verifyLiveCtaKey } from "./liveCtaKeys";
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
  validateEcpayCallback,
} from "./ecpay";
import { processVerifiedEcpayPayment } from "./offerPayments";
import {
  createSalesPageSchema,
  salesPageCanPublish,
  salesPageSlugSchema,
  salesPageVersionSchema,
  updateSalesPageSchema,
  validatePublishableBlocks,
} from "./salesPages";
import { buildLeadInsights, scoreLeadInsight } from "./leadInsights";

// ===== AI 點數計費常數 =====
const AI_POINTS_PER_REPLY = 1; // 每則 AI 回覆扣的點數
const AI_POINTS_PER_GENERATION = 5; // 每次 AI 一鍵生成（互動 / 電子報 / 貼文）扣的點數
const AI_WEBINAR_WIZARD_POINTS = 30;
const POINTS_PER_TWD = 1; // 1 元 = 1 點
const RECHARGE_MIN_TWD = 100; // 自訂金額最低消費
const RECHARGE_PACKAGES: Record<string, number> = { p300: 300, p1000: 1000, p3000: 3000 }; // 固定儲值包（元）
const OUT_OF_POINTS_DEFAULT = "感謝您的提問！目前線上客服忙線中，主辦團隊將盡快親自回覆您 🙏";
export const OFFER_CHECKOUT_RATE_LIMIT = { namespace: "offer-checkout", limit: 20, windowSeconds: 60 } as const;

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
  if (!user || !user.isSuperAdmin) {
    return res.status(403).json({ message: "Forbidden" });
  }
  next();
}

async function requireWebinarOwner(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const webinarId = req.params.id as string | undefined;
  if (webinarId) {
    const webinar = await storage.getWebinar(webinarId);
    if (!webinar || webinar.userId !== req.session.userId) {
      return res.status(403).json({ message: "Forbidden" });
    }
  }
  next();
}

async function requirePublishedOrOwner(req: Request, res: Response, next: NextFunction) {
  const webinar = await storage.getWebinar(req.params.id as string);
  if (!webinar) return res.status(404).json({ message: "Webinar not found" });
  if (!canViewWebinar(webinar, req.session?.userId)) {
    return res.status(404).json({ message: "Webinar not found" });
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

function publicWebinar<T extends { vimeoUrl?: string | null }>(webinar: T): Omit<T, "vimeoUrl"> {
  const { vimeoUrl: _vimeoUrl, ...safe } = withSafeTrackingIds(webinar as any);
  return safe;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express,
  sessionMiddleware?: any,
  dependencies: {
    refreshEntitlement?: typeof refreshSubscriptionEntitlement;
    startScheduler?: typeof startEmailScheduler;
  } = {},
): Promise<Server> {
  const refreshEntitlement = dependencies.refreshEntitlement ?? refreshSubscriptionEntitlement;
  const startScheduler = dependencies.startScheduler ?? startEmailScheduler;
  // 發問通知信節流：每個直播間最短寄送間隔
  const questionNotifyThrottle = new Map<string, number>();
  const QUESTION_NOTIFY_COOLDOWN_MS = 60 * 1000;

  // Allow iframe embedding for embed routes
  app.use((req, res, next) => {
    if (req.path.startsWith('/embed/') || req.path === '/livecast-widget.js') {
      res.removeHeader('X-Frame-Options');
      res.setHeader('Content-Security-Policy', "frame-ancestors *");
    }
    const isPublicGetRoute =
      (req.method === 'GET' || req.method === 'OPTIONS') &&
       (req.path.match(/^\/api\/webinars\/[^/]+$/) || /^\/api\/webinars\/[^/]+\/landing-page$/.test(req.path) || /^\/api\/sales-pages\/[^/]+$/.test(req.path) || req.path === '/api/webinars') &&
      !req.path.includes('/stats/');
    const isPublicPostRoute =
      (req.method === 'POST' || req.method === 'OPTIONS') &&
      (req.path === '/api/registrations' || /^\/api\/webinars\/[^/]+\/funnel-events$/.test(req.path));
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

  // ============ Image Upload ============
  const uploadsDir = path.join(process.cwd(), "client", "public", "uploads");
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  const uploadStorage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || ".png";
      const name = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}${ext}`;
      cb(null, name);
    },
  });

  const upload = multer({
    storage: uploadStorage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const allowed = ["image/jpeg", "image/png", "image/gif", "image/webp"];
      if (allowed.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error("只允許上傳圖片格式 (jpg, png, gif, webp)"));
      }
    },
  });

  app.post("/api/upload", requireAdmin, upload.single("file"), (req: Request, res: Response) => {
    if (!req.file) {
      return res.status(400).json({ message: "未選擇檔案" });
    }
    const url = `/uploads/${req.file.filename}`;
    res.json({ url, filename: req.file.filename });
  });

  app.delete("/api/upload", requireAdmin, (req: Request, res: Response) => {
    const { url } = req.body;
    if (url && url.startsWith("/uploads/")) {
      const filename = url.replace("/uploads/", "");
      if (filename && !filename.includes("/") && !filename.includes("..")) {
        const filePath = path.join(uploadsDir, filename);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }
    }
    res.json({ success: true });
  });

  const serveStatic = (await import("express")).default.static;
  app.use("/uploads", serveStatic(uploadsDir, {
    maxAge: "1d",
    immutable: true,
  }));

  // WebSocket Server
  const wss = new WebSocketServer({ noServer: true });
  httpServer.on("upgrade", (request, socket, head) => {
    const pathname = new URL(request.url || "/", "http://localhost").pathname;
    if (pathname !== "/ws") return;
    wss.handleUpgrade(request, socket, head, (client) => {
      wss.emit("connection", client, request);
    });
  });

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

    ws.on("message", async (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        switch (message.type) {
          case "join": {
            // A socket already authorized as host must not be downgraded/retargeted
            // to a viewer context (prevents cross-tenant context switching).
            if (isHost) break;
            // Each viewer gets a unique session - complete isolation
            const { webinarId, sessionId, nickname, watchToken } = message.data;
            if (typeof webinarId !== "string" || typeof sessionId !== "string") break;
            await sessionReady;
            const requestedWebinar = await storage.getWebinar(webinarId);
            if (!requestedWebinar || !canViewWebinar(requestedWebinar, sessionUserId)) {
              ws.send(JSON.stringify({
                type: "error",
                data: { message: "Webinar not found or unavailable" },
              }));
              break;
            }
            const isOwner = requestedWebinar.userId === sessionUserId;
            if (!isOwner) {
              const token = verifyWatchToken(watchToken);
              const registration = token && token.webinarId === webinarId
                ? await storage.getRegistration(token.registrationId)
                : undefined;
              if (!registration || registration.webinarId !== webinarId) {
                ws.send(JSON.stringify({ type: "error", data: { message: "Invalid watch token" } }));
                break;
              }
              if (registration.selectedSession && new Date(registration.selectedSession).getTime() > Date.now()) {
                ws.send(JSON.stringify({ type: "error", data: { message: "This session has not started" } }));
                break;
              }
              currentRegistrationId = registration.id;
            }
            currentWebinarId = webinarId;
            currentSessionId = sessionId;
            
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
            if (!sessionUserId || !ownedWebinar || ownedWebinar.userId !== sessionUserId) {
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

            const savedMessage = await storage.createChatMessage({
              webinarId,
              sessionId,
              senderName,
              message: chatMessage,
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
            maybeAiReply(webinarId, sessionId, chatMessage).catch((err) =>
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
            if (!process.env.SESSION_SECRET) break;
            const { text, url, style, durationSec } = message.data || {};
            if (!text || !url) break;
            // Use the same server-side CTA URL policy as persisted CTAs.
            const parsedUrl = safeCtaUrlSchema.safeParse(String(url));
            if (!parsedUrl.success) break;
            const safeUrl = parsedUrl.data;
            const duration = Number.isFinite(Number(durationSec))
              ? Math.max(1, Math.min(2 * 60 * 60, Math.floor(Number(durationSec))))
              : 2 * 60 * 60;
            const liveCtaKey = createLiveCtaKey(
              currentWebinarId,
              process.env.SESSION_SECRET || "",
              { expiresAt: new Date(Date.now() + duration * 1000) },
            );
            const payload = {
              // Live CTAs have no persisted UUID. This signed key is their sole tracking identity.
              id: liveCtaKey,
              ctaKey: liveCtaKey,
              text: String(text),
              url: safeUrl,
              style: style || "primary",
              expiresAt: Date.now() + duration * 1000,
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
      if (currentWebinarId) {
        if (isHost) {
          hostConnections.get(currentWebinarId)?.delete(ws);
        } else if (currentSessionId) {
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

  // AI 助教：判斷觀眾訊息是否為問題，是則用文檔回答，以老師名義私訊回覆該觀眾
  // 把一則「以老師名義」的私訊送給觀眾並同步給主持人
  async function sendAiMessage(webinarId: string, sessionId: string, teacherName: string, text: string) {
    const savedMessage = await storage.createChatMessage({
      webinarId,
      sessionId,
      senderName: teacherName,
      message: text,
      senderType: "host",
      isPrivate: true,
    });
    const viewerWs = sessionConnections.get(sessionId);
    if (viewerWs && viewerWs.readyState === WebSocket.OPEN) {
      viewerWs.send(JSON.stringify({ type: "chat", data: savedMessage }));
    }
    broadcastToHosts(webinarId, { type: "chat", data: { ...savedMessage, sessionId } });
  }

  async function maybeAiReply(webinarId: string, sessionId: string, viewerMessage: string) {
    const webinar = await storage.getWebinar(webinarId);
    const ai = webinar?.aiSettings;
    if (!webinar || !ai?.enabled) return;
    if (!looksLikeQuestion(viewerMessage)) return;

    const teacherName = (ai.teacherName || "").trim() || "老師";

    // 點數檢查：AI 回覆消耗「該直播間擁有廠商」的點數。
    // 超級管理員/企業方案無限制；點數用完則顯示預設訊息、不呼叫 AI（省成本）。
    const ownerId = webinar.userId;
    const owner = ownerId ? await storage.getUser(ownerId) : undefined;
    const unlimited = !!owner && (owner.isSuperAdmin || owner.subscriptionPlan === "enterprise");
    const outOfPointsMsg = (ai.outOfPointsMessage || "").trim() || OUT_OF_POINTS_DEFAULT;

    // 先原子預扣（reserve）再呼叫 AI：避免「只剩 1 點 + 並發多題」時兩題都呼叫 Anthropic 浪費成本。
    // 預扣失敗（不足）→ 顯示預設訊息、不呼叫 AI。
    let reservationId: string | null = null;
    if (!unlimited) {
      const reservation = ownerId ? await storage.reserveAiCredits(ownerId, AI_POINTS_PER_REPLY) : null;
      if (!reservation) {
        await sendAiMessage(webinarId, sessionId, teacherName, outOfPointsMsg);
        return;
      }
      reservationId = reservation.reservationId;
    }

    const answer = await answerViewerQuestion(
      webinarId,
      webinar.title,
      teacherName,
      viewerMessage,
      ai.fallbackMessage
    );
    if (!answer) {
      // AI 失敗：退回預扣的點數（不向觀眾收費）
      if (reservationId) await storage.refundAiCreditReservation(reservationId);
      return;
    }

    if (reservationId) await storage.finalizeAiCreditReservation(reservationId);
    await sendAiMessage(webinarId, sessionId, teacherName, answer);
  }

  // ============ Auth Routes ============
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
      const rawToken = createRawToken();
      await storage.createAuthToken(user.id, "email_verification", hashToken(rawToken), new Date(Date.now() + 30 * 60 * 1000));
      const verificationUrl = `${appBaseUrl()}/verify-email?token=${encodeURIComponent(rawToken)}`;
      await sendTransactionalMail({
        to: user.email,
        subject: "Verify your email",
        html: `<p>Please verify your account. This link expires in 30 minutes.</p><p><a href="${verificationUrl}">Verify email</a></p>`,
      });
      res.status(201).json({ success: true, verificationRequired: true });
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
    req.session.regenerate((error) => {
      if (error) return res.status(500).json({ message: "登入失敗" });
      req.session.userId = user.id;
      req.session.save((saveError) => {
        if (saveError) return res.status(500).json({ message: "登入失敗" });
        res.json({ success: true, user: { id: user.id, username: user.username, email: user.email, companyName: user.companyName, isSuperAdmin: user.isSuperAdmin } });
      });
    });
  });

  app.post("/api/admin/verify-email", async (req, res) => {
    const token = typeof req.body?.token === "string" ? req.body.token : "";
    if (!token || token.length > 256) return res.status(400).json({ message: "Invalid or expired token" });
    const consumed = await storage.consumeEmailVerificationToken(hashToken(token));
    if (!consumed) return res.status(400).json({ message: "Invalid or expired token" });
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
      const rawToken = createRawToken();
      await storage.createAuthToken(user.id, "email_verification", hashToken(rawToken), new Date(Date.now() + 30 * 60 * 1000));
      await sendTransactionalMail({
        to: user.email,
        subject: "Verify your email",
        html: `<p><a href="${appBaseUrl()}/verify-email?token=${encodeURIComponent(rawToken)}">Verify email</a>. This link expires in 30 minutes.</p>`,
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
    res.json({ id: user.id, username: user.username, email: user.email, companyName: user.companyName, isSuperAdmin: user.isSuperAdmin });
  });

  app.get("/api/admin/subscription", requireAdmin, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(401).json({ message: "Unauthorized" });
      const entitlement = await refreshEntitlement(user);
      const webinarCount = await storage.getWebinarCountByUser(user.id);
      const publishedCount = await storage.getPublishedWebinarCountByUser(user.id);
      res.json({
        plan: entitlement.plan,
        amountUsd: entitlement.amountUsd,
        status: entitlement.status,
        active: entitlement.active,
        planStartedAt: entitlement.startedAt,
        planExpiresAt: entitlement.currentPeriodEnd,
        cancelAtPeriodEnd: entitlement.cancelAtPeriodEnd,
        addonWebinars: entitlement.addonWebinars,
        maxWebinars: entitlement.maxWebinars,
        webinarCount,
        publishedCount,
        isActive: user.isActive,
        isExpired: !entitlement.active && entitlement.plan !== "enterprise",
        isSuperAdmin: user.isSuperAdmin,
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
    try {
      const { subscriptionPlan, planExpiresAt, maxWebinars, isActive } = req.body;
      const updateData: any = {};
      if (subscriptionPlan !== undefined) updateData.subscriptionPlan = subscriptionPlan;
      if (planExpiresAt !== undefined) updateData.planExpiresAt = planExpiresAt ? new Date(planExpiresAt) : null;
      if (maxWebinars !== undefined) updateData.maxWebinars = maxWebinars;
      if (isActive !== undefined) updateData.isActive = isActive;
      const updated = await storage.updateUser(req.params.userId as string, updateData);
      if (!updated) return res.status(404).json({ message: "User not found" });
      const webinarCount = await storage.getWebinarCountByUser(updated.id);
      res.json({ ...updated, webinarCount });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
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
    const status = req.body?.status;
    const adminNote = req.body?.adminNote;
    if (status !== undefined && !["open", "in_progress", "resolved", "closed"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }
    if (adminNote !== undefined && adminNote !== null && (typeof adminNote !== "string" || adminNote.length > 5000)) {
      return res.status(400).json({ message: "Invalid admin note" });
    }
    const updated = await storage.updateSupportFeedback(req.params.id as string, { status, adminNote });
    if (!updated) return res.status(404).json({ message: "Support feedback not found" });
    res.json(updated);
  });

  // ============ Webinar Routes ============
  app.get("/api/webinars", async (req, res) => {
    if (req.session?.userId) {
      const webinars = await storage.getWebinarsByUser(req.session.userId);
      return res.json(webinars);
    }
    const webinars = await storage.getAllWebinars();
    res.json(webinars
      .filter((webinar) => webinar.publishStatus === "published")
      .map(publicWebinar));
  });

  app.get("/api/webinars/stats/summary", requireAdmin, async (req, res) => {
    try {
      const allWebinars = await storage.getWebinarsByUser(req.session.userId!);
      const stats: Record<string, { registered: number; attended: number; engaged: number; onlineCount: number }> = {};
      
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
        
        stats[webinar.id] = { registered, attended, engaged, onlineCount };
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
    const isOwner = webinar.userId === req.session?.userId;
    res.json(isOwner ? withSafeTrackingIds(webinar) : publicWebinar(webinar));
  });

  app.post("/api/webinars", requireAdmin, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user || !user.isActive) {
        return res.status(403).json({ message: "帳號已停用" });
      }
      const data = insertWebinarSchema.parse({
        ...req.body,
        userId: req.session.userId,
        publishStatus: "draft",
      });
      const webinar = await storage.createWebinar(data);
      res.json(webinar);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  const aiWebinarWizardSchema = z.object({
    title: z.string().trim().min(2).max(160),
    audience: z.string().trim().min(2).max(1000),
    goal: z.string().trim().min(2).max(2000),
    ctaText: z.string().trim().max(120).default(""),
    ctaUrl: z.union([z.literal(""), z.string().url().refine((url) => /^https?:\/\//i.test(url), "CTA 網址只允許 HTTP(S)")]).default(""),
    sourceContent: z.string().max(40000).default(""),
    vimeoUrl: z.union([z.literal(""), z.string().url().refine((url) => /^https:\/\/(?:www\.)?vimeo\.com\//i.test(url), "請輸入有效的 Vimeo 網址")]).default(""),
    startTime: z.coerce.date(),
    videoDuration: z.coerce.number().int().min(0).max(86400).default(0),
  }).strict();

  app.post("/api/webinars/ai-wizard", requireAdmin, async (req, res) => {
    const ownerId = req.session.userId!;
    const owner = await storage.getUser(ownerId);
    if (!owner) return res.status(401).json({ message: "Unauthorized" });
    if (!owner.isActive) return res.status(403).json({ message: "Account is suspended" });
    let input: z.infer<typeof aiWebinarWizardSchema>;
    try {
      input = aiWebinarWizardSchema.parse(req.body);
    } catch (error: any) {
      return res.status(400).json({ message: error.message });
    }

    const unlimited = owner.isSuperAdmin || owner.subscriptionPlan === "enterprise";
    const reservation = unlimited ? null : await storage.reserveAiCredits(ownerId, AI_WEBINAR_WIZARD_POINTS);
    if (!unlimited && !reservation) {
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
        vimeoUrl: input.vimeoUrl,
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

      res.json({
        success: true,
        webinar,
        pointsUsed: unlimited ? 0 : AI_WEBINAR_WIZARD_POINTS,
        remainingPoints: unlimited ? null : reservation!.remaining,
        counts: {
          messages: interactions.messages.length,
          polls: interactions.polls.length,
          tips: interactions.tips.length,
          ctas: safeCtas.length,
          emails: emails.length,
        },
      });
    } catch (error: any) {
      let refunded = !reservation;
      if (reservation) {
        try {
          await storage.refundAiCreditReservation(reservation.reservationId);
          refunded = true;
        } catch (refundError) {
          console.error("AI wizard credit refund failed:", refundError);
          void persistProductionError(refundError, req, 500).catch(() => {});
        }
      }
      res.status(502).json({
        message: refunded
          ? "AI 建立失敗，請稍後再試（未扣點）"
          : "AI 建立失敗，點數退款處理異常，系統已通知客服協助處理",
      });
    }
  });

  app.delete("/api/webinars/:id", requireWebinarOwner, async (req, res) => {
    await storage.deleteWebinar(req.params.id as string);
    res.json({ success: true });
  });

  app.patch("/api/webinars/:id", requireWebinarOwner, async (req, res) => {
    try {
      const data = { ...req.body };
      delete data.publishStatus;
      delete data.userId;
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
      const webinar = await storage.updateWebinar(req.params.id as string, data);
      if (!webinar) {
        return res.status(404).json({ message: "Webinar not found" });
      }
      res.json(webinar);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // ============ Publish / Unpublish Webinar ============
  app.post("/api/webinars/:id/publish", requireWebinarOwner, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user || !user.isActive) {
        return res.status(403).json({ message: "帳號已停用" });
      }
      const entitlement = await refreshEntitlement(user);
      if (!entitlement.active) {
        return res.status(403).json({ message: "SUBSCRIPTION_REQUIRED", code: "SUBSCRIPTION_REQUIRED" });
      }
      const maxPublished = entitlement.maxWebinars;
      const publishResult = await storage.publishWebinarWithinLimit(user.id, req.params.id as string, maxPublished);
      if (publishResult.limitExceeded) {
        return res.status(403).json({ message: "PUBLISH_LIMIT", code: "PUBLISH_LIMIT", maxPublished });
      }
      const webinar = publishResult.webinar;
      if (!webinar) {
        return res.status(404).json({ message: "Webinar not found" });
      }
      res.json(webinar);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

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
    res.json({ webinar: withSafeTrackingIds(webinar), landingPage: page, preview: true });
  });

  app.get("/api/webinars/:id/landing-page", async (req, res) => {
    const webinar = await storage.getWebinar(req.params.id as string);
    if (!webinar) return res.status(404).json({ message: "找不到說明會" });
    const page = await storage.getPublicWebinarLandingPage(webinar.id);
    if (!page) return res.status(404).json({ message: "說明會落地頁尚未發布" });
    res.json({ webinar: publicWebinar(webinar), landingPage: page, preview: false });
  });

  app.post("/api/webinars/:id/landing-page", requireWebinarOwner, async (req, res) => {
    try {
      const webinar = await storage.getWebinar(req.params.id as string);
      if (!webinar) return res.status(404).json({ message: "找不到說明會" });
      const existing = await storage.getWebinarLandingPage(webinar.id);
      if (existing) return res.json(existing);
      const input = req.body && Object.keys(req.body).length
        ? createWebinarLandingPageSchema.parse(req.body)
        : { title: webinar.title, blocks: defaultWebinarLandingTemplate(webinar), brandSettings: DEFAULT_WEBINAR_LANDING_BRAND };
      res.status(201).json(await storage.createWebinarLandingPage({ webinarId: webinar.id, ...input }));
    } catch (error: any) {
      res.status(400).json({ message: error.message || "落地頁資料格式錯誤" });
    }
  });

  app.patch("/api/webinars/:id/landing-page", requireWebinarOwner, async (req, res) => {
    try {
      const input = updateWebinarLandingPageSchema.parse(req.body);
      const page = await storage.updateWebinarLandingPage(req.params.id as string, input.version, {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.blocks !== undefined ? { blocks: input.blocks } : {}),
        ...(input.brandSettings !== undefined ? { brandSettings: input.brandSettings } : {}),
      });
      if (!page) return res.status(409).json({ message: "版本已更新，請重新載入後再儲存", code: "VERSION_CONFLICT" });
      res.json(page);
    } catch (error: any) { res.status(400).json({ message: error.message || "落地頁資料格式錯誤" }); }
  });

  app.post("/api/webinars/:id/landing-page/publish", requireWebinarOwner, async (req, res) => {
    try {
      const input = webinarLandingVersionSchema.parse(req.body);
      const webinar = await storage.getWebinar(req.params.id as string);
      const page = await storage.getWebinarLandingPage(req.params.id as string);
      if (!webinar || !page) return res.status(404).json({ message: "找不到落地頁" });
      const allowed = webinarLandingPageCanPublish(webinar, page.blocks);
      if (!allowed.ok) return res.status(409).json({ message: allowed.message });
      const published = await storage.setWebinarLandingPageStatus(webinar.id, input.version, "published");
      if (!published) return res.status(409).json({ message: "版本衝突或說明會已取消發布", code: "VERSION_CONFLICT" });
      res.json(published);
    } catch (error: any) { res.status(400).json({ message: error.message || "發布資料格式錯誤" }); }
  });

  app.post("/api/webinars/:id/landing-page/unpublish", requireWebinarOwner, async (req, res) => {
    try {
      const input = webinarLandingVersionSchema.parse(req.body);
      const page = await storage.setWebinarLandingPageStatus(req.params.id as string, input.version, "draft");
      if (!page) return res.status(409).json({ message: "版本衝突，請重新載入後再試", code: "VERSION_CONFLICT" });
      res.json(page);
    } catch (error: any) { res.status(400).json({ message: error.message || "取消發布資料格式錯誤" }); }
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
      { key: "starter", amountUsd: 39, annualAmountUsd: 397.8, includedWebinars: 1, monthlyRegistrants: 1_000, monthlyAiPoints: 100, trialDays: 7 },
      { key: "growth", amountUsd: 99, annualAmountUsd: 1009.8, includedWebinars: 5, monthlyRegistrants: 3_000, monthlyAiPoints: 200, trialDays: 7 },
      { key: "scale", amountUsd: 199, annualAmountUsd: 2029.8, includedWebinars: 15, monthlyRegistrants: 5_000, monthlyAiPoints: 300, trialDays: 7 },
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
        plans: planDefinitions.map((plan) => ({ ...plan, available: false })),
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

        let previousTrialSessionExpired = false;
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
          if (openSession.id === lockedUser.stripeSubscriptionCheckoutSessionId) {
            previousTrialSessionExpired = true;
          }
        }
        if (lockedUser.stripeSubscriptionCheckoutSessionId && !previousTrialSessionExpired) {
          const priorSession = await stripe.checkout.sessions.retrieve(lockedUser.stripeSubscriptionCheckoutSessionId);
          previousTrialSessionExpired = priorSession.status === "expired";
        }

        const trialEligible = previousSubscriptions.data.length === 0
          && (!lockedUser.stripeTrialClaimedAt || previousTrialSessionExpired);
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
          subscription_data: {
            metadata: { userId: lockedUser.id, planKey, billingInterval, addonWebinars: String(addonWebinars) },
            ...(trialEligible ? { trial_period_days: 7 } : {}),
          },
          success_url: `${baseUrl}/admin/dashboard?checkout=success`,
          cancel_url: `${baseUrl}/admin/dashboard?checkout=cancel`,
        });
        await tx.update(users).set({
          stripeSubscriptionCheckoutSessionId: created.id,
          ...(trialEligible ? { stripeTrialClaimedAt: new Date() } : {}),
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
        const summary = await storage.getAiCreditSummary(user.id);
        return res.json({ success: true, alreadyProcessed: true, points: summary.points });
      }

      const stripe = await getUncachableStripeClient();
      const session = await stripe.checkout.sessions.retrieve(sessionId);

      if (session.payment_status !== "paid") {
        return res.status(400).json({ message: "尚未完成付款" });
      }
      // 必須是本人的、且是點數充值的 session
      if (session.metadata?.userId !== user.id || session.metadata?.kind !== "ai_points") {
        return res.status(403).json({ message: "無效的付款資訊" });
      }

      const points = parseInt(session.metadata.points || "0", 10);
      const amountTwd = parseInt(session.metadata.amountTwd || "0", 10);
      if (points <= 0) return res.status(400).json({ message: "無效的點數" });

      // 交易記錄 + 加點同一個 DB transaction（冪等 + 一致性，可安全重試）
      const result = await storage.creditPointPurchase({ userId: user.id, points, amountTwd, stripeSessionId: sessionId });
      res.json({ success: true, added: result.alreadyProcessed ? 0 : points, points: result.points, alreadyProcessed: result.alreadyProcessed });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // 超級管理員手動贈送點數
  app.post("/api/super-admin/users/:id/grant-points", requireAdmin, async (req, res) => {
    try {
      const admin = await storage.getUser(req.session.userId!);
      if (!admin?.isSuperAdmin) return res.status(403).json({ message: "需要超級管理員權限" });
      const points = Math.floor(Number(req.body?.points));
      if (!Number.isFinite(points) || points <= 0) return res.status(400).json({ message: "無效的點數" });
      const target = await storage.getUser(String(req.params.id));
      if (!target) return res.status(404).json({ message: "找不到使用者" });
      const result = await storage.grantAiCredits({ userId: target.id, points, source: "admin_grant" });
      res.json({ success: true, points: result.points });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ============ Registration Routes ============
  app.post("/api/registrations", async (req, res) => {
    try {
      const body = { ...req.body };
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
      let data = insertRegistrationSchema.parse(body);

      const webinarCheck = await storage.getWebinar(data.webinarId);
      if (!webinarCheck || webinarCheck.publishStatus !== "published") {
        return res.status(403).json({ message: "此直播間尚未發佈，無法報名" });
      }
      const publishedLanding = await storage.getPublicWebinarLandingPage(webinarCheck.id);
      if (!publishedLanding) {
        return res.status(403).json({ message: "此說明會落地頁尚未發布，暫時無法報名" });
      }
      if (!process.env.SESSION_SECRET) {
        return res.status(503).json({ message: "Registration is temporarily unavailable" });
      }
      const persistedSessions = await storage.getWebinarSessions(webinarCheck.id);
      const eligibilityNow = new Date();
      const availability = getAvailableSessions(webinarCheck, persistedSessions, eligibilityNow);
      const selectedSession = availability.mode === "justInTime"
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
      const monthlyRegistrantLimit = getMonthlyRegistrantLimit(webinarOwner?.subscriptionPlan || "");
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
        registrationId: registration.id, name: data.name, email: data.email
      });
      
      const webinar = await storage.getWebinar(data.webinarId);
      if (webinar) {
        const baseUrl = `${req.protocol}://${req.get("host")}`;
        try {
          await createEmailRemindersForRegistration(registration, webinar, baseUrl, watchToken);
        } catch (reminderError) {
          console.error("Failed to create reminders:", reminderError);
        }
      }
      
      res.json({ ...registration, watchToken });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
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
      const updated = await storage.updateRegistration(req.params.regId as string, { tags });
      res.json(updated);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/webinars/:id/registrations", requireWebinarOwner, async (req, res) => {
    const registrations = await storage.getRegistrationsByWebinar(req.params.id as string);
    res.json(registrations);
  });

  // Owner-only, read-only deterministic sales insights.
  app.get("/api/webinars/:id/lead-insights", requireWebinarOwner, async (req, res) => {
    const webinar = await storage.getWebinar(req.params.id as string);
    if (!webinar) return res.status(404).json({ message: "Webinar not found" });
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

  // ============ Attendance Tracking ============
  app.post("/api/registrations/:id/attend", async (req, res) => {
    try {
      const registration = await storage.updateRegistration(req.params.id, {
        attended: true,
        attendedAt: new Date(),
      });
      res.json(registration);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.post("/api/registrations/:id/leave", async (req, res) => {
    try {
      const registration = await storage.getRegistration(req.params.id);
      if (registration && registration.attendedAt) {
        const watchDuration = Math.floor((Date.now() - new Date(registration.attendedAt).getTime()) / 1000);
        const updated = await storage.updateRegistration(req.params.id, {
          leftAt: new Date(),
          watchDuration,
        });
        res.json(updated);
      } else {
        res.json(registration);
      }
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // ============ Fake Users Routes ============
  app.get("/api/webinars/:id/fake-users", requirePublishedOrOwner, async (req, res) => {
    const fakeUsers = await storage.getFakeUsersByWebinar(req.params.id as string);
    res.json(fakeUsers);
  });

  app.post("/api/webinars/:id/fake-users", requireWebinarOwner, async (req, res) => {
    try {
      const data = insertFakeUserSchema.parse({
        ...req.body,
        webinarId: req.params.id
      });
      const fakeUser = await storage.createFakeUser(data);
      res.json(fakeUser);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/webinars/:id/fake-users/:userId", requireWebinarOwner, async (req, res) => {
    await storage.deleteFakeUser(req.params.userId as string);
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
      const message = await storage.createScheduledMessage(data);
      res.json(message);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/webinars/:id/scheduled-messages/:msgId", requireWebinarOwner, async (req, res) => {
    await storage.deleteScheduledMessage(req.params.msgId as string);
    res.json({ success: true });
  });

  // ============ CTA Buttons Routes ============
  app.get("/api/webinars/:id/ctas", requirePublishedOrOwner, async (req, res) => {
    const ctas = await storage.getCtaButtonsByWebinar(req.params.id as string);
    res.json(ctas);
  });

  app.post("/api/webinars/:id/ctas", requireWebinarOwner, async (req, res) => {
    try {
      const data = insertCtaButtonSchema.parse({
        ...req.body,
        webinarId: req.params.id
      });
      if (data.offerId) {
        const offer = await storage.getWebinarOffer(data.offerId);
        if (!offer || !offer.active || offer.webinarId !== req.params.id) {
          return res.status(400).json({ message: "offerId does not belong to this webinar" });
        }
      }
      const cta = await storage.createCtaButton(data);
      res.json(cta);
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
      const valid = validateEcpayCallback(
        fields,
        {
          merchantId: payment.merchantIdSnapshot!,
          merchantTradeNo: payment.providerOrderId!,
          amount: payment.amountMinor,
          hashKey: decryptEcpayCredential(payment.providerHashKeySnapshot),
          hashIv: decryptEcpayCredential(payment.providerHashIvSnapshot),
        },
      );
      if (!valid) return fail();
      await processVerifiedEcpayPayment(tradeNo);
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

  app.post("/api/webinars/:id/sales-pages", requireWebinarOwner, async (req, res) => {
    try {
      const webinarId = req.params.id as string;
      const input = createSalesPageSchema.parse(req.body);
      const offer = await storage.getWebinarOffer(input.offerId);
      if (!offer || !offer.active || offer.webinarId !== webinarId) {
        return res.status(400).json({ message: "Offer must be active and belong to this webinar" });
      }
      const page = await storage.createOfferSalesPage({
        webinarId,
        offerId: offer.id,
        slug: input.slug,
        title: input.title,
        orderedBlocks: input.blocks,
      });
      res.status(201).json(page);
    } catch (error: any) {
      if (error?.code === "23505") {
        return res.status(409).json({ message: "Slug or offer already has a sales page" });
      }
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/webinars/:id/sales-pages/:pageId", requireWebinarOwner, async (req, res) => {
    try {
      const webinarId = req.params.id as string;
      const pageId = req.params.pageId as string;
      const input = updateSalesPageSchema.parse(req.body);
      const existing = await storage.getOfferSalesPage(webinarId, pageId);
      if (!existing) return res.status(404).json({ message: "Sales page not found" });
      if (existing.status === "published" && input.blocks !== undefined) {
        validatePublishableBlocks(input.blocks);
      }
      const page = await storage.updateOfferSalesPage(webinarId, pageId, input.version, {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.slug !== undefined ? { slug: input.slug } : {}),
        ...(input.blocks !== undefined ? { orderedBlocks: input.blocks } : {}),
      });
      if (!page) return res.status(409).json({ message: "Version conflict", code: "VERSION_CONFLICT" });
      res.json(page);
    } catch (error: any) {
      if (error?.code === "23505") return res.status(409).json({ message: "Slug is already in use" });
      res.status(400).json({ message: error.message });
    }
  });

  app.post("/api/webinars/:id/sales-pages/:pageId/publish", requireWebinarOwner, async (req, res) => {
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
      if (!offer || offer.webinarId !== webinarId) {
        return res.status(409).json({ message: "Linked offer is unavailable" });
      }
      const allowed = salesPageCanPublish(webinar, offer, page.orderedBlocks);
      if (!allowed.ok) return res.status(409).json({ message: allowed.message });
      const published = await storage.setOfferSalesPageStatus(webinarId, pageId, input.version, "published");
      if (!published) return res.status(409).json({ message: "Version conflict or publication requirements changed", code: "VERSION_CONFLICT" });
      res.json(published);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

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
      let display: { name: string; amountMinor: number | null; currency: string };
      if (offer.paymentProvider === "ecpay") {
        display = { name: offer.ecpayItemName!, amountMinor: offer.ecpayAmountTwd, currency: "TWD" };
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
        blocks: page.orderedBlocks,
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

  app.get("/api/webinars/:id/offers", requireWebinarOwner, async (req, res) => {
    try {
      const webinarId = req.params.id as string;
      const offers = await storage.getWebinarOffers(webinarId);
      const result = await Promise.all(offers.map(async (offer) => {
        if (offer.paymentProvider === "ecpay") {
          return { ...offer, name: offer.ecpayItemName, amountMinor: offer.ecpayAmountTwd, currency: "TWD" };
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
      const input = createWebinarOfferSchema.parse(req.body);
      if (input.paymentProvider === "ecpay") {
        const [connection] = await db.select().from(ecpayConnections).where(and(
          eq(ecpayConnections.userId, req.session.userId!),
          eq(ecpayConnections.enabled, true),
        )).limit(1);
        if (!connection) return res.status(409).json({ message: "請先設定並啟用 ECPay 金流" });
        const offer = await storage.createWebinarOffer({
          webinarId,
          paymentProvider: "ecpay",
          ecpayItemName: input.name,
          ecpayAmountTwd: input.amountMinor,
          checkoutMode: "payment",
        });
        return res.json({ ...offer, name: offer.ecpayItemName, amountMinor: offer.ecpayAmountTwd, currency: "TWD" });
      }
      const stripe = await getUncachableStripeClient();
      const product = await stripe.products.create({
        name: input.name,
        metadata: { kind: "webinar_offer", webinarId },
      });
      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: input.amountMinor,
        currency: input.currency.toLowerCase(),
        metadata: { kind: "webinar_offer", webinarId },
      });
      const offer = await storage.createWebinarOffer({
        webinarId,
        paymentProvider: "stripe",
        stripeProductId: product.id,
        stripePriceId: price.id,
        checkoutMode: input.checkoutMode,
      });
      res.json({ ...offer, name: product.name, amountMinor: price.unit_amount, currency: price.currency.toUpperCase() });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  const offerCheckoutSchema = z.object({
    ctaId: z.string().uuid().optional(),
    offerId: z.string().uuid().optional(),
    salesPageId: z.string().uuid().optional(),
    registrationId: z.string().uuid().optional(),
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
    });

  app.post("/api/webinars/:id/offer-checkout", async (req, res) => {
    try {
      const webinarId = req.params.id;
      const input = offerCheckoutSchema.parse(req.body);
      const webinar = await storage.getWebinar(webinarId);
      if (!webinar || webinar.publishStatus !== "published") return res.status(404).json({ message: "Webinar not found" });
      let cta: Awaited<ReturnType<typeof storage.getCtaButtonsByWebinar>>[number] | undefined;
      let offer: Awaited<ReturnType<typeof storage.getWebinarOffer>> | undefined;
      if (input.ctaId) {
        // A persisted CTA is the established webinar-room attribution flow.
        cta = (await storage.getCtaButtonsByWebinar(webinarId)).find(item => item.id === input.ctaId);
        if (!cta?.offerId) return res.status(400).json({ message: "CTA is not linked to an offer" });
        offer = await storage.getWebinarOffer(cta.offerId);
        if (!offer || !offer.active || offer.webinarId !== webinarId) {
          return res.status(400).json({ message: "Offer is unavailable" });
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
      }
      if (input.registrationId) {
        const registration = await storage.getRegistration(input.registrationId);
        if (!registration || registration.webinarId !== webinarId) {
          return res.status(400).json({ message: "registrationId does not belong to this webinar" });
        }
      }

      const visitorTokenHash = input.visitorToken ? sha256(input.visitorToken) : "";
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
        const [payment] = await db.insert(webinarPayments).values({
          webinarId,
          offerId: offer.id,
          ctaId: cta?.id,
          registrationId: input.registrationId,
          visitorTokenHash: visitorTokenHash || null,
          paymentProvider: "ecpay",
          providerOrderId: tradeNo,
          ecpayConnectionId: connection.id,
          merchantIdSnapshot: connection.merchantId,
          providerEnvironment: connection.environment,
          providerHashKeySnapshot: connection.hashKeyEncrypted,
          providerHashIvSnapshot: connection.hashIvEncrypted,
          amountMinor: amountTwd,
          currency: "TWD",
          status: "pending",
        }).returning();
        const fields: Record<string, string | number> = {
          MerchantID: connection.merchantId,
          MerchantTradeNo: tradeNo,
          MerchantTradeDate: merchantTradeDate(),
          PaymentType: "aio",
          TotalAmount: payment.amountMinor,
          TradeDesc: "Webinar offer",
          ItemName: offer.ecpayItemName.replace(/[<>&#]/g, " ").slice(0, 200),
          ReturnURL: `${appBaseUrl()}/api/ecpay/return`,
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
      const metadata = {
        kind: "webinar_offer",
        webinarId,
        offerId: offer.id,
        ...(cta ? { ctaId: cta.id } : {}),
        stripePriceId: offer.stripePriceId,
        ...(input.registrationId ? { registrationId: input.registrationId } : {}),
        ...(visitorTokenHash ? { visitorTokenHash } : {}),
      };
      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: [{ price: offer.stripePriceId!, quantity: 1 }],
        metadata,
        payment_intent_data: { metadata },
        client_reference_id: input.registrationId || undefined,
        success_url: `${baseUrl}/webinar/${encodeURIComponent(webinarId)}?checkout=success`,
        cancel_url: `${baseUrl}/webinar/${encodeURIComponent(webinarId)}?checkout=cancel`,
      });
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
    await storage.deleteCtaButton(req.params.ctaId as string);
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
    await storage.deletePoll(req.params.pollId as string);
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
    await storage.deleteTip(req.params.tipId as string);
    res.json({ success: true });
  });

  // ============ Questions (Q&A) Routes ============
  app.get("/api/webinars/:id/questions", requirePublishedOrOwner, async (req, res) => {
    const questionsList = await storage.getQuestionsByWebinar(req.params.id as string);
    res.json(questionsList);
  });

  app.get("/api/webinars/:id/questions/preset", requirePublishedOrOwner, async (req, res) => {
    const presetQuestions = await storage.getPresetQuestions(req.params.id as string);
    res.json(presetQuestions);
  });

  app.post("/api/webinars/:id/questions", requirePublishedOrOwner, async (req, res) => {
    try {
      const data = insertQuestionSchema.parse({
        ...req.body,
        webinarId: req.params.id
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
            const baseUrl = `${req.protocol}://${req.get("host")}`;
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
      const question = await storage.updateQuestion(req.params.questionId as string, req.body);
      res.json(question);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/webinars/:id/questions/:questionId", requireWebinarOwner, async (req, res) => {
    await storage.deleteQuestion(req.params.questionId as string);
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
      const survey = await storage.updateFeedbackSurvey(req.params.surveyId as string, req.body);
      res.json(survey);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // ============ Feedback Responses Routes ============
  app.post("/api/feedback-responses", async (req, res) => {
    try {
      const data = insertFeedbackResponseSchema.parse(req.body);
      const response = await storage.createFeedbackResponse(data);
      res.json(response);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/feedback-surveys/:surveyId/responses", requireAdmin, async (req, res) => {
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
      await storage.deleteWebinarSession(req.params.sessionId as string);
      res.json({ success: true });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // ============ Webinar Duplication ============
  app.post("/api/webinars/:id/duplicate", requireWebinarOwner, async (req, res) => {
    try {
      const sourceWebinar = await storage.getWebinar(req.params.id as string);
      if (!sourceWebinar) {
        return res.status(404).json({ message: "Webinar not found" });
      }

      const newWebinar = await storage.createWebinar({
        title: `${sourceWebinar.title} (副本)`,
        description: sourceWebinar.description || undefined,
        vimeoUrl: sourceWebinar.vimeoUrl,
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
        userId: req.session.userId,
      });

      const [sourceFakeUsers, sourceMessages, sourceCtas, sourcePolls, sourceTips, sourceOffers] = await Promise.all([
        storage.getFakeUsersByWebinar(sourceWebinar.id),
        storage.getScheduledMessagesByWebinar(sourceWebinar.id),
        storage.getCtaButtonsByWebinar(sourceWebinar.id),
        storage.getPollsByWebinar(sourceWebinar.id),
        storage.getTipsByWebinar(sourceWebinar.id),
        storage.getWebinarOffers(sourceWebinar.id),
      ]);

      const fakeUserIdMap = new Map<string, string>();
      for (const fu of sourceFakeUsers) {
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
        const copied = await storage.createWebinarOffer({
          webinarId: newWebinar.id,
          stripeProductId: offer.stripeProductId,
          stripePriceId: offer.stripePriceId,
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
        });
      }

      res.json(newWebinar);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

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
    const selectedSession = registration.selectedSession ? new Date(registration.selectedSession) : null;
    const canWatch = !selectedSession || selectedSession.getTime() <= Date.now();
    res.json({
      selectedSession,
      canWatch,
      waitUntil: canWatch ? null : selectedSession,
      mode: selectedSession ? "scheduled" : "onDemand",
      ...(canWatch ? { vimeoUrl: webinar.vimeoUrl } : {}),
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
      const registration = await storage.updateRegistration(req.params.id as string, {
        attended: true,
        attendedAt: new Date(),
      });
      res.json(registration);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.post("/api/registrations/:id/leave", async (req, res) => {
    try {
      const { watchDuration } = req.body;
      const registration = await storage.updateRegistration(req.params.id as string, {
        leftAt: new Date(),
        watchDuration,
      });
      res.json(registration);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // ============ Webhooks ============
  async function dispatchWebhook(webinarId: string, eventType: string, payload: any) {
    try {
      const hooks = await storage.getWebhooksByEvent(webinarId, eventType);
      for (const hook of hooks) {
        const body = JSON.stringify({ event: eventType, data: payload, timestamp: new Date().toISOString() });
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (hook.secret) {
          const signature = crypto.createHmac("sha256", hook.secret).update(body).digest("hex");
          headers["X-Webhook-Signature"] = signature;
        }
        fetch(hook.targetUrl, { method: "POST", headers, body }).catch(err => {
          console.error(`Webhook delivery failed for ${hook.targetUrl}:`, err.message);
        });
      }
    } catch (err) {
      console.error("Webhook dispatch error:", err);
    }
  }

  app.get("/api/webinars/:id/webhooks", requireWebinarOwner, async (req, res) => {
    const hooks = await storage.getWebhooksByWebinar(req.params.id as string);
    res.json(hooks);
  });

  app.post("/api/webinars/:id/webhooks", requireWebinarOwner, async (req, res) => {
    try {
      const data = insertWebhookSchema.parse({ ...req.body, webinarId: req.params.id });
      const hook = await storage.createWebhook(data);
      res.json(hook);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/webinars/:id/webhooks/:hookId", requireWebinarOwner, async (req, res) => {
    try {
      const hook = await storage.updateWebhook(req.params.hookId as string, req.body);
      res.json(hook);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/webinars/:id/webhooks/:hookId", requireWebinarOwner, async (req, res) => {
    await storage.deleteWebhook(req.params.hookId as string);
    res.json({ success: true });
  });

  // ============ AI 助教知識文檔 ============
  app.get("/api/webinars/:id/documents", requireWebinarOwner, async (req, res) => {
    const docs = await storage.getWebinarDocuments(req.params.id as string);
    res.json(docs);
  });

  app.post("/api/webinars/:id/documents", requireWebinarOwner, async (req, res) => {
    try {
      const data = insertWebinarDocumentSchema.parse({ ...req.body, webinarId: req.params.id });
      const doc = await storage.createWebinarDocument(data);
      res.json(doc);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/webinars/:id/documents/:docId", requireWebinarOwner, async (req, res) => {
    await storage.deleteWebinarDocument(req.params.id as string, req.params.docId as string);
    res.json({ success: true });
  });

  // 後台 AI 試問：不建立聊天室訊息，也不向任何 WebSocket 廣播。
  app.post("/api/webinars/:id/ai/test-question", requireWebinarOwner, async (req, res) => {
    const webinarId = req.params.id as string;
    const parsed = z.object({
      question: z.string().trim().min(1, "請輸入測試問題").max(2000, "測試問題不可超過 2000 字"),
    }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0]?.message || "測試問題格式不正確" });
    }

    const webinar = await storage.getWebinar(webinarId);
    if (!webinar) return res.status(404).json({ message: "找不到直播間" });
    const documents = await storage.getWebinarDocuments(webinarId);
    if (!documents.some(document => document.content.trim())) {
      return res.status(400).json({ message: "尚未加入知識文檔，請先新增內容再試問" });
    }

    const owner = webinar.userId ? await storage.getUser(webinar.userId) : undefined;
    const unlimited = !!owner && (owner.isSuperAdmin || owner.subscriptionPlan === "enterprise");
    let reservationId: string | null = null;
    if (!unlimited) {
      const reservation = webinar.userId
        ? await storage.reserveAiCredits(webinar.userId, AI_POINTS_PER_REPLY)
        : null;
      if (!reservation) {
        return res.status(402).json({
          message: `AI 點數不足，本次試問需要 ${AI_POINTS_PER_REPLY} 點，請先儲值`,
        });
      }
      reservationId = reservation.reservationId;
    }

    try {
      const ai = webinar.aiSettings;
      const teacherName = (ai?.teacherName || "").trim() || "老師";
      const answer = await answerViewerQuestion(
        webinarId,
        webinar.title,
        teacherName,
        parsed.data.question,
        ai?.fallbackMessage,
        true,
      );
      if (!answer) {
        if (reservationId) await storage.refundAiCreditReservation(reservationId);
        return res.status(502).json({ message: "AI 暫時無法完成回答，點數已退回，請稍後再試" });
      }
      if (reservationId) await storage.finalizeAiCreditReservation(reservationId);
      return res.json({ answer, pointsCharged: unlimited ? 0 : AI_POINTS_PER_REPLY, unlimited });
    } catch (error) {
      if (reservationId) {
        try {
          await storage.refundAiCreditReservation(reservationId);
        } catch (refundError) {
          console.error("Failed to refund AI test-question reservation:", refundError);
        }
      }
      console.error("AI test question failed:", error);
      return res.status(502).json({ message: "AI 暫時無法完成回答，點數已退回，請稍後再試" });
    }
  });

  // ============ AI 一鍵生成（互動 / 電子報 / 貼文）============
  // 共用：預扣點數（reserve）。回 { ok, remaining } 或 { ok:false, reason }
  async function reserveGenerationPoints(webinarId: string): Promise<{ ok: true; reservationId: string | null } | { ok: false; status: number; message: string }> {
    const webinar = await storage.getWebinar(webinarId);
    if (!webinar) return { ok: false, status: 404, message: "找不到直播間" };
    const ownerId = webinar.userId || null;
    const owner = ownerId ? await storage.getUser(ownerId) : undefined;
    const unlimited = !!owner && (owner.isSuperAdmin || owner.subscriptionPlan === "enterprise");
    if (unlimited || !ownerId) return { ok: true, reservationId: null };
    const reservation = await storage.reserveAiCredits(ownerId, AI_POINTS_PER_GENERATION);
    if (!reservation) {
      return { ok: false, status: 402, message: `AI 點數不足，本次生成需要 ${AI_POINTS_PER_GENERATION} 點，請先儲值` };
    }
    return { ok: true, reservationId: reservation.reservationId };
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
        return res.status(502).json({ message: "AI 生成失敗，請稍後再試（未扣點）" });
      }

      // 可選：先清除既有互動內容
      if (replace) {
        const [msgs, ctas, tps, pls] = await Promise.all([
          storage.getScheduledMessagesByWebinar(webinarId),
          storage.getCtaButtonsByWebinar(webinarId),
          storage.getTipsByWebinar(webinarId),
          storage.getPollsByWebinar(webinarId),
        ]);
        await Promise.all([
          ...msgs.map((m) => storage.deleteScheduledMessage(m.id)),
          ...ctas.map((c) => storage.deleteCtaButton(c.id)),
          ...tps.map((t) => storage.deleteTip(t.id)),
          ...pls.map((p) => storage.deletePoll(p.id)),
        ]);
      }

      // 建立假人並對應名稱 → id
      const nameToId = new Map<string, string>();
      for (const name of result.fakeUsers) {
        const fu = await storage.createFakeUser({ webinarId, name });
        nameToId.set(name, fu.id);
      }
      for (const m of result.messages) {
        await storage.createScheduledMessage({
          webinarId,
          fakeUserId: nameToId.get(m.name) || null,
          message: m.message,
          triggerTime: m.triggerTime,
          messageType: "chat",
        } as any);
      }
      for (const p of result.polls) {
        await storage.createPoll({ webinarId, question: p.question, options: p.options, triggerTime: p.triggerTime } as any);
      }
      for (const t of result.tips) {
        await storage.createTip({ webinarId, title: t.title, content: t.content, triggerTime: t.triggerTime, icon: t.icon } as any);
      }
      for (const c of result.ctas) {
        await storage.createCtaButton({ webinarId, text: c.text, url: c.url, startTime: c.startTime } as any);
      }

      if (reserve.reservationId) await storage.finalizeAiCreditReservation(reserve.reservationId);
      res.json({
        success: true,
        counts: {
          fakeUsers: result.fakeUsers.length,
          messages: result.messages.length,
          polls: result.polls.length,
          tips: result.tips.length,
          ctas: result.ctas.length,
        },
      });
    } catch (error: any) {
      if (reserve.reservationId) await storage.refundAiCreditReservation(reserve.reservationId);
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
        return res.status(404).json({ message: "找不到直播間" });
      }
      const goal = typeof req.body?.goal === "string" ? req.body.goal : "";
      const replace = req.body?.replace === true;
      const knowledge = await getWebinarKnowledge(webinarId);
      const emails = await generateEmailSequence(webinar.title, goal, knowledge);
      if (!emails || emails.length === 0) {
        if (reserve.reservationId) await storage.refundAiCreditReservation(reserve.reservationId);
        return res.status(502).json({ message: "AI 生成失敗，請稍後再試（未扣點）" });
      }
      if (replace) {
        const existing = await storage.getEmailSequences(webinarId);
        await Promise.all(existing.map((e) => storage.deleteEmailSequence(webinarId, e.id)));
      }
      let order = 0;
      const created = [];
      for (const e of emails) {
        const seq = await storage.createEmailSequence({
          webinarId,
          name: e.name,
          segment: e.segment,
          delayMinutes: e.delayMinutes,
          subject: e.subject,
          htmlBody: e.htmlBody,
          enabled: true,
          sortOrder: order++,
        } as any);
        created.push(seq);
      }
      if (reserve.reservationId) await storage.finalizeAiCreditReservation(reserve.reservationId);
      res.json({ success: true, count: created.length, sequences: created });
    } catch (error: any) {
      if (reserve.reservationId) await storage.refundAiCreditReservation(reserve.reservationId);
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
        return res.status(404).json({ message: "找不到直播間" });
      }
      const goal = typeof req.body?.goal === "string" ? req.body.goal : "";
      const replace = req.body?.replace === true;
      const knowledge = await getWebinarKnowledge(webinarId);
      const posts = await generateSocialPosts(webinar.title, goal, knowledge);
      if (!posts || posts.length === 0) {
        if (reserve.reservationId) await storage.refundAiCreditReservation(reserve.reservationId);
        return res.status(502).json({ message: "AI 生成失敗，請稍後再試（未扣點）" });
      }
      if (replace) {
        const existing = await storage.getSocialPosts(webinarId);
        await Promise.all(existing.map((p) => storage.deleteSocialPost(webinarId, p.id)));
      }
      const created = [];
      for (const p of posts) {
        const sp = await storage.createSocialPost({ webinarId, platform: p.platform, content: p.content, status: "draft" } as any);
        created.push(sp);
      }
      if (reserve.reservationId) await storage.finalizeAiCreditReservation(reserve.reservationId);
      res.json({ success: true, count: created.length, posts: created });
    } catch (error: any) {
      if (reserve.reservationId) await storage.refundAiCreditReservation(reserve.reservationId);
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
