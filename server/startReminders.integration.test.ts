import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool } from "./db";
import { storage } from "./storage";
import { emailReminders, registrations, users, webinars, webinarSessions } from "@shared/schema";

test("upcoming booking backfill is fenced against concurrent enqueue and skips opted-out, deleted, cancelled and past bookings", async () => {
  assert.notEqual(process.env.NODE_ENV, "production");
  const userId = randomUUID();
  const webinarId = randomUUID();
  // Far-future test clock keeps the real development mail worker from sending.
  const now = new Date("2099-01-01T00:00:00Z");
  const start = new Date(now.getTime() + 60 * 60_000);
  try {
    await db.insert(users).values({ id: userId, username: `start-${userId}`, password: "test-only" });
    await db.insert(webinars).values({
      id: webinarId, userId, title: "Reminder isolation fixture", startTime: start, vimeoUrl: "",
      publishStatus: "published", emailSettings: {
        confirmationEnabled: false, reminder24hEnabled: false, reminder1hEnabled: true,
        followUpEnabled: false, customSubject: "", customTemplate: "",
      },
    });
    const [active, archived, deleted, past, immediate, cancelled, tooLate] = await db.insert(registrations).values([
      { selectedSession: start },
      { selectedSession: start, archivedAt: now },
      { selectedSession: start, deletedAt: now },
      { selectedSession: new Date(now.getTime() - 11 * 60_000) },
      { selectedSession: null },
      { selectedSession: new Date(start.getTime() + 60_000) },
      { selectedSession: new Date(now.getTime() + 120_000) },
    ].map((row, index) => ({ ...row, webinarId, name: "Fixture", email: `nobody-${index}@example.test`, phone: "" }))).returning();
    await db.insert(webinarSessions).values({
      webinarId, scheduledStart: cancelled.selectedSession!, status: "cancelled",
    });
    await Promise.all([
      storage.enqueueUpcomingStartReminders(now),
      storage.enqueueUpcomingStartReminders(now),
      storage.createEmailReminder({
        webinarId, registrationId: active.id, reminderType: "reminder_5m",
        scheduledFor: new Date(start.getTime() - 300_000), status: "pending",
      }),
    ]);
    await storage.enqueueUpcomingStartReminders(now);
    let rows = await db.select().from(emailReminders).where(eq(emailReminders.webinarId, webinarId));
    assert.equal(rows.length, 8);
    for (const registration of [active, archived]) {
      const reminders = rows.filter(row => row.registrationId === registration.id);
      assert.deepEqual(reminders.map(row => row.reminderType).sort(), ["reminder_5m", "reminder_no_show_10m", "reminder_start"]);
      assert.equal(reminders.find(row => row.reminderType === "reminder_5m")!.scheduledFor.getTime(), start.getTime() - 300_000);
      assert.equal(reminders.find(row => row.reminderType === "reminder_start")!.scheduledFor.getTime(), start.getTime());
      assert.equal(reminders.find(row => row.reminderType === "reminder_no_show_10m")!.scheduledFor.getTime(), start.getTime() + 600_000);
    }
    assert.deepEqual(rows.filter(row => row.registrationId === tooLate.id).map(row => row.reminderType).sort(), ["reminder_no_show_10m", "reminder_start"]);
    for (const registration of [deleted, past, immediate, cancelled]) {
      assert.equal(rows.filter(row => row.registrationId === registration.id).length, 0);
    }
    // A repeat registration with the same email and session must not make an
    // already-attending person receive a no-show message.
    assert.equal(await storage.hasAttendedSession(active), false);
    await db.update(registrations).set({ attended: true, attendedAt: now }).where(eq(registrations.id, active.id));
    const [repeat] = await db.insert(registrations).values({
      webinarId, name: "Repeat fixture", email: ` ${active.email.toUpperCase()} `,
      phone: "", selectedSession: start,
    }).returning();
    assert.equal(await storage.hasAttendedSession(repeat), true);
    assert.equal(await storage.hasAttendedSession(archived), false);
    assert.equal(await storage.hasAttendedSession({ ...repeat, selectedSession: new Date(start.getTime() + 60_000) }), false);
    await storage.enqueueUpcomingStartReminders(now);
    assert.equal((await db.select().from(emailReminders).where(eq(emailReminders.registrationId, repeat.id)))
      .filter(row => row.reminderType === "reminder_no_show_10m").length, 0);
    await db.delete(emailReminders).where(eq(emailReminders.webinarId, webinarId));
    await db.update(webinars).set({
      emailSettings: {
        confirmationEnabled: false, reminder24hEnabled: false, reminder1hEnabled: false,
        followUpEnabled: false, customSubject: "", customTemplate: "",
      },
    }).where(eq(webinars.id, webinarId));
    await storage.enqueueUpcomingStartReminders(now);
    rows = await db.select().from(emailReminders).where(eq(emailReminders.webinarId, webinarId));
    assert.equal(rows.length, 0);
    await db.update(webinars).set({ publishStatus: "draft" }).where(eq(webinars.id, webinarId));
    await storage.enqueueUpcomingStartReminders(now);
    assert.equal((await db.select().from(emailReminders).where(eq(emailReminders.webinarId, webinarId))).length, 0);
  } finally {
    await db.delete(emailReminders).where(eq(emailReminders.webinarId, webinarId));
    await db.delete(registrations).where(eq(registrations.webinarId, webinarId));
    await db.delete(webinarSessions).where(eq(webinarSessions.webinarId, webinarId));
    await db.delete(webinars).where(eq(webinars.id, webinarId));
    await db.delete(users).where(eq(users.id, userId));
    await pool.end();
  }
});
