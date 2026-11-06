import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "./db";
import { registerSessionNotificationRoutes, shouldDeliverManualSessionNotice } from "./sessionNotifications";
import { buildDeferredEmail } from "./email-scheduler";
import { verifyWatchTokenFor } from "./watchTokens";
import { users, webinars, webinarSessions, registrations, emailReminders, sessionNotificationBatches } from "@shared/schema";

test("manual session notices enforce ownership, confirmed audience/counts, atomic idempotency, cooldown and delivery revalidation", async () => {
  assert.notEqual(process.env.NODE_ENV, "production");
  const owner = randomUUID(), outsider = randomUUID(), webinarId = randomUUID(), otherWebinar = randomUUID();
  const sessionId = randomUUID(), otherSession = randomUUID();
  // Queue only far-future jobs: the live development worker cannot claim them.
  let clock = new Date("2099-01-01T00:00:00Z");
  const start = new Date("2099-01-01T01:00:00Z");
  let actor: string | undefined = owner;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).session = { userId: actor }; next(); });
  registerSessionNotificationRoutes(app, (req, res, next) => {
    if (!req.session?.userId) { res.status(401).json({ message: "Unauthorized" }); return; }
    next();
  }, { now: () => clock });
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api/webinars/${webinarId}/sessions`;
  const post = (path: string, body: object) => fetch(base + path, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  try {
    await db.insert(users).values([owner, outsider].map(id => ({ id, username: `notice-${id}`, password: "test-only", isActive: true })));
    await db.insert(webinars).values([webinarId, otherWebinar].map(id => ({
      id, userId: id === webinarId ? owner : outsider, title: "Notification fixture",
      vimeoUrl: "", startTime: start, publishStatus: "published", videoDuration: 3600,
      emailSettings: { confirmationEnabled: false, reminder24hEnabled: false, reminder1hEnabled: false, followUpEnabled: false, customSubject: "", customTemplate: "" },
    })));
    await db.insert(webinarSessions).values([
      { id: sessionId, webinarId, scheduledStart: start },
      { id: otherSession, webinarId: otherWebinar, scheduledStart: start },
    ]);
    const [absent, attended] = await db.insert(registrations).values([
      { webinarId, name: "Absent", email: "absent@example.test", phone: "", selectedSession: start },
      { webinarId, name: "Attended", email: "attended@example.test", phone: "", selectedSession: start, attended: true },
      { webinarId, name: "Repeat", email: " ABSENT@EXAMPLE.TEST ", phone: "", selectedSession: start, archivedAt: clock },
      { webinarId, name: "Deleted", email: "deleted@example.test", phone: "", selectedSession: start, deletedAt: clock },
      { webinarId, name: "Other time", email: "other@example.test", phone: "", selectedSession: new Date(start.getTime() + 86_400_000) },
      { webinarId: otherWebinar, name: "Other owner", email: "owner@example.test", phone: "", selectedSession: start },
    ]).returning();
    actor = undefined;
    assert.equal((await fetch(`${base}/${sessionId}/notifications/preview?audience=all`)).status, 401);
    actor = outsider;
    assert.equal((await fetch(`${base}/${sessionId}/notifications/preview?audience=all`)).status, 403);
    assert.equal((await post(`/${sessionId}/notifications`, { audience: "all", requestId: randomUUID(), expectedCount: 2 })).status, 403);
    actor = owner;
    assert.equal((await fetch(`${base}/${otherSession}/notifications/preview?audience=all`)).status, 404);
    assert.equal((await post(`/${otherSession}/notifications`, { audience: "all", requestId: randomUUID(), expectedCount: 1 })).status, 404);
    assert.equal((await fetch(`${base}/${sessionId}/notifications/preview?audience=invalid`)).status, 400);
    assert.equal((await post(`/${sessionId}/notifications`, { audience: "all", requestId: "invalid", expectedCount: 2 })).status, 400);
    for (const [audience, count] of [["all", 2], ["absent", 1]] as const) {
      const response = await fetch(`${base}/${sessionId}/notifications/preview?audience=${audience}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      const body = await response.json();
      assert.equal(body.recipientCount, count);
      assert.equal(JSON.stringify(body).includes("@example.test"), false);
    }
    assert.equal((await post(`/${sessionId}/notifications`, { audience: "all", requestId: randomUUID(), expectedCount: 1 })).status, 409);
    assert.equal((await db.select().from(sessionNotificationBatches).where(eq(sessionNotificationBatches.webinarId, webinarId))).length, 0);
    const requestId = randomUUID();
    const payload = { audience: "all", requestId, expectedCount: 2 };
    const responses = await Promise.all([post(`/${sessionId}/notifications`, payload), post(`/${sessionId}/notifications`, payload)]);
    assert.deepEqual(responses.map(response => response.status), [200, 200]);
    const results = await Promise.all(responses.map(response => response.json()));
    assert.deepEqual(results.map(body => body.replayed).sort(), [false, true]);
    let jobs = await db.select().from(emailReminders).where(eq(emailReminders.notificationBatchId, requestId));
    assert.equal(jobs.length, 2);
    assert.ok(jobs.every(job => job.reminderType === "manual_session_notice" && job.scheduledFor.getTime() === clock.getTime()));
    const replay = await post(`/${sessionId}/notifications`, payload);
    assert.equal((await replay.json()).replayed, true, "retry after lost response must not enqueue again");
    assert.equal((await post(`/${sessionId}/notifications`, { ...payload, audience: "absent" })).status, 409);
    const cooldown = await post(`/${sessionId}/notifications`, { ...payload, requestId: randomUUID() });
    assert.equal(cooldown.status, 429);
    assert.equal(cooldown.headers.get("retry-after"), "60");
    assert.equal(await shouldDeliverManualSessionNotice(jobs.find(job => job.registrationId === attended.id)!, clock), true);

    clock = new Date(clock.getTime() + 61_000);
    const absentId = randomUUID();
    assert.equal((await post(`/${sessionId}/notifications`, { audience: "absent", requestId: absentId, expectedCount: 1 })).status, 200);
    const [absentJob] = await db.select().from(emailReminders).where(eq(emailReminders.notificationBatchId, absentId));
    assert.equal(await shouldDeliverManualSessionNotice(absentJob, clock), true);
    // Any repeat registration joining suppresses absent-only delivery.
    await db.update(registrations).set({ attended: true, attendedAt: clock }).where(eq(registrations.id, absent.id));
    assert.equal(await shouldDeliverManualSessionNotice(absentJob, clock), false);
    const secret = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = "manual-notice-test-only";
    try {
      const [registration] = await db.select().from(registrations).where(eq(registrations.id, absentJob.registrationId));
      const [webinar] = await db.select().from(webinars).where(eq(webinars.id, webinarId));
      const built = buildDeferredEmail(absentJob, registration, {
        ...webinar, emailSettings: { ...webinar.emailSettings!, customSubject: "Generic subject", customTemplate: "Generic body" },
      }, "https://example.test");
      assert.match(built.subject, /要上線囉/);
      assert.match(built.html, /專屬觀看連結/);
      const match = /watchToken=([^"'&<\s]+)/.exec(built.html);
      assert.ok(match);
      assert.ok(verifyWatchTokenFor(decodeURIComponent(match[1]), registration.id, webinarId));
      assert.equal(verifyWatchTokenFor(decodeURIComponent(match[1]), attended.id, webinarId), null);
    } finally {
      if (secret === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = secret;
    }
    clock = new Date(start.getTime() + 3_600_000);
    assert.equal(await shouldDeliverManualSessionNotice(jobs[0], clock), false);
    assert.equal((await post(`/${sessionId}/notifications`, { ...payload, requestId: randomUUID() })).status, 409);
    clock = new Date("2099-01-01T00:00:00Z");
    await db.update(webinars).set({ publishStatus: "draft" }).where(eq(webinars.id, webinarId));
    assert.equal((await fetch(`${base}/${sessionId}/notifications/preview?audience=all`)).status, 409);
    await db.update(webinars).set({ publishStatus: "published" }).where(eq(webinars.id, webinarId));
    await db.update(webinarSessions).set({ status: "cancelled" }).where(eq(webinarSessions.id, sessionId));
    assert.equal(await shouldDeliverManualSessionNotice(jobs[0], clock), false);
    assert.equal((await fetch(`${base}/${sessionId}/notifications/preview?audience=all`)).status, 409);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await db.delete(emailReminders).where(inArray(emailReminders.webinarId, [webinarId, otherWebinar]));
    await db.delete(sessionNotificationBatches).where(inArray(sessionNotificationBatches.webinarId, [webinarId, otherWebinar]));
    await db.delete(registrations).where(inArray(registrations.webinarId, [webinarId, otherWebinar]));
    await db.delete(webinarSessions).where(inArray(webinarSessions.webinarId, [webinarId, otherWebinar]));
    await db.delete(webinars).where(inArray(webinars.id, [webinarId, otherWebinar]));
    await db.delete(users).where(inArray(users.id, [owner, outsider]));
    await pool.end();
  }
});
