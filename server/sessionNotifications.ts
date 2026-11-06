import type { Express, RequestHandler } from "express";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { storage } from "./storage";
import { emailReminders, registrations, sessionNotificationBatches, users, webinars, webinarSessions, type EmailReminder } from "@shared/schema";

const audienceSchema = z.enum(["all", "absent"]);
export type NoticeAudience = z.infer<typeof audienceSchema>;
const noticeSchema = z.object({
  audience: audienceSchema,
  requestId: z.string().uuid(),
  expectedCount: z.number().int().min(1).max(1_000_000),
}).strict();
type QueryDb = Pick<typeof db, "select" | "execute">;

export class SessionNoticeError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function sessionContext(query: QueryDb, webinarId: string, sessionId: string, now: Date) {
  const [webinar] = await query.select().from(webinars).where(eq(webinars.id, webinarId));
  const [session] = await query.select().from(webinarSessions).where(and(
    eq(webinarSessions.id, sessionId), eq(webinarSessions.webinarId, webinarId),
  ));
  if (!webinar || !session) throw new SessionNoticeError(404, "找不到這個直播間的場次");
  if (webinar.publishStatus !== "published") throw new SessionNoticeError(409, "直播間尚未發佈，無法補發上線通知");
  const end = session.scheduledEnd?.getTime() ?? (session.scheduledStart.getTime() + (webinar.videoDuration || 3600) * 1000);
  if (session.status === "cancelled" || session.status === "ended" || end <= now.getTime()) {
    throw new SessionNoticeError(409, "場次已取消或已結束，不能再補發上線通知");
  }
  return { webinar, session };
}

async function requireActor(query: QueryDb, webinarId: string, actorId: string) {
  const [actor] = await query.select().from(users).where(eq(users.id, actorId));
  const [webinar] = await query.select().from(webinars).where(eq(webinars.id, webinarId));
  if (!actor?.isActive || !webinar || (webinar.userId !== actorId && !actor.isSuperAdmin)) {
    throw new SessionNoticeError(403, "無權操作這個直播間");
  }
}

async function recipients(query: QueryDb, webinarId: string, start: Date, audience: NoticeAudience) {
  const result = await query.execute(sql`
    SELECT DISTINCT ON (lower(trim(r.email))) r.id
    FROM registrations r
    WHERE r.webinar_id = ${webinarId} AND r.selected_session = ${start.toISOString()}::timestamp
      AND r.deleted_at IS NULL AND length(trim(r.email)) > 0
      AND (${audience} = 'all' OR NOT EXISTS (
        SELECT 1 FROM registrations a WHERE a.webinar_id = r.webinar_id
          AND a.selected_session = r.selected_session AND a.deleted_at IS NULL
          AND lower(trim(a.email)) = lower(trim(r.email))
          AND (a.attended IS TRUE OR a.attended_at IS NOT NULL OR a.watch_duration > 0)
      ))
    ORDER BY lower(trim(r.email)), r.registered_at DESC, r.id DESC
  `);
  return result.rows.map(row => String(row.id));
}

export async function previewSessionNotice(webinarId: string, sessionId: string, actorId: string, audience: NoticeAudience, now = new Date()) {
  await requireActor(db, webinarId, actorId);
  const { session, webinar } = await sessionContext(db, webinarId, sessionId, now);
  const ids = await recipients(db, webinarId, session.scheduledStart, audience);
  return { recipientCount: ids.length, audience, scheduledStart: session.scheduledStart, timezone: webinar.timezone || "Asia/Taipei" };
}

export async function enqueueSessionNotice(webinarId: string, sessionId: string, actorId: string, body: unknown, now = new Date()) {
  const input = noticeSchema.parse(body);
  return db.transaction(async tx => {
    await requireActor(tx, webinarId, actorId);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"manual-session-notice:" + webinarId + ":" + sessionId}))`);
    const [existing] = await tx.select().from(sessionNotificationBatches).where(eq(sessionNotificationBatches.id, input.requestId));
    if (existing) {
      if (existing.webinarId !== webinarId || existing.sessionId !== sessionId || existing.audience !== input.audience || existing.createdBy !== actorId) {
        throw new SessionNoticeError(409, "這次通知的確認資料不一致，請重新開啟視窗");
      }
      return { batchId: existing.id, queuedCount: existing.recipientCount, replayed: true };
    }
    const { session } = await sessionContext(tx, webinarId, sessionId, now);
    const [recent] = await tx.select().from(sessionNotificationBatches).where(and(
      eq(sessionNotificationBatches.webinarId, webinarId), eq(sessionNotificationBatches.sessionId, sessionId),
      sql`${sessionNotificationBatches.createdAt} > ${new Date(now.getTime() - 60_000).toISOString()}::timestamp`,
    ));
    if (recent) throw new SessionNoticeError(429, "這個場次剛補發過通知，請至少等 1 分鐘再寄");
    const ids = await recipients(tx, webinarId, session.scheduledStart, input.audience);
    if (!ids.length) throw new SessionNoticeError(409, "目前沒有符合條件的收件人");
    if (ids.length !== input.expectedCount) throw new SessionNoticeError(409, "收件人數已變動，請重新確認人數再發送");
    await tx.insert(sessionNotificationBatches).values({
      id: input.requestId, webinarId, sessionId, scheduledStart: session.scheduledStart,
      audience: input.audience, recipientCount: ids.length, createdBy: actorId, createdAt: now,
    });
    for (let offset = 0; offset < ids.length; offset += 500) {
      await tx.insert(emailReminders).values(ids.slice(offset, offset + 500).map(registrationId => ({
        webinarId, registrationId, notificationBatchId: input.requestId,
        reminderType: "manual_session_notice", scheduledFor: now, status: "pending",
      })));
    }
    return { batchId: input.requestId, queuedCount: ids.length, replayed: false };
  });
}

export async function shouldDeliverManualSessionNotice(reminder: EmailReminder, now = new Date()) {
  if (!reminder.notificationBatchId) return false;
  const [batch] = await db.select().from(sessionNotificationBatches).where(and(
    eq(sessionNotificationBatches.id, reminder.notificationBatchId), eq(sessionNotificationBatches.webinarId, reminder.webinarId),
  ));
  if (!batch) return false;
  let context;
  try { context = await sessionContext(db, batch.webinarId, batch.sessionId, now); }
  catch (error) { if (error instanceof SessionNoticeError) return false; throw error; }
  const registration = await storage.getRegistration(reminder.registrationId);
  if (!registration || registration.deletedAt || registration.webinarId !== batch.webinarId ||
      registration.selectedSession?.getTime() !== batch.scheduledStart.getTime() ||
      context.session.scheduledStart.getTime() !== batch.scheduledStart.getTime()) return false;
  return batch.audience === "all" || !(await storage.hasAttendedSession(registration));
}

export function registerSessionNotificationRoutes(app: Express, requireOwner: RequestHandler, options: { now?: () => Date } = {}) {
  const now = options.now ?? (() => new Date());
  const path = "/api/webinars/:id/sessions/:sessionId/notifications";
  const fail = (res: any, error: unknown) => {
    if (error instanceof z.ZodError) return res.status(400).json({ message: "通知參數不正確" });
    if (error instanceof SessionNoticeError) {
      if (error.status === 429) res.setHeader("Retry-After", "60");
      return res.status(error.status).json({ message: error.message });
    }
    console.error("Session notification failed:", error);
    return res.status(500).json({ message: "無法處理上線通知，請使用同次操作重試" });
  };
  app.get(path + "/preview", requireOwner, async (req, res) => {
    try {
      const audience = audienceSchema.parse(req.query.audience);
      res.setHeader("Cache-Control", "no-store");
      res.json(await previewSessionNotice(String(req.params.id), String(req.params.sessionId), req.session.userId!, audience, now()));
    } catch (error) { fail(res, error); }
  });
  app.post(path, requireOwner, async (req, res) => {
    try {
      res.json(await enqueueSessionNotice(String(req.params.id), String(req.params.sessionId), req.session.userId!, req.body, now()));
    } catch (error) { fail(res, error); }
  });
}
