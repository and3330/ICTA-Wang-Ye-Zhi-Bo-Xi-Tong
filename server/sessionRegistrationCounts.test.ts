import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import express from "express";
import { createServer } from "node:http";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { getBatchSessionRegistrationCounts } from "./sessionRegistrationCounts";
import { registerRoutes } from "./routes";
import { storage } from "./storage";
import {
  registrations,
  registrationIdentityKeys,
  users,
  webinars,
  webinarSessions,
  type User,
  type Webinar,
} from "@shared/schema";

function sumRows(counts: { registrationCount: number }[]) {
  return counts.reduce((total, row) => total + row.registrationCount, 0);
}

test("session registration counts aggregate complete history, zero slots, and timestamp buckets", async (t) => {
  assert.notEqual(process.env.NODE_ENV, "production");

  const suffix = crypto.randomUUID();
  const ownerId = crypto.randomUUID();
  const otherOwnerId = crypto.randomUUID();
  const fixedWebinarId = crypto.randomUUID();
  const recurringWebinarId = crypto.randomUUID();
  const jitWebinarId = crypto.randomUUID();
  const onDemandWebinarId = crypto.randomUUID();
  const otherWebinarId = crypto.randomUUID();
  const fixedDuplicateSessionId = crypto.randomUUID();
  const fixedDuplicateSessionTwoId = crypto.randomUUID();
  const fixedZeroSessionId = crypto.randomUUID();
  const fixedCancelledSessionId = crypto.randomUUID();
  const ownerWebinarIds = [fixedWebinarId, recurringWebinarId, jitWebinarId, onDemandWebinarId];
  const allWebinarIds = [...ownerWebinarIds, otherWebinarId];
  const registrationIds: string[] = [];
  const sessionIds = [
    fixedDuplicateSessionId,
    fixedDuplicateSessionTwoId,
    fixedZeroSessionId,
    fixedCancelledSessionId,
  ];

  const fixedMain = new Date("2030-01-01T00:00:00.000Z");
  const fixedDuplicateStart = new Date("2030-01-02T00:00:00.000Z");
  const fixedZeroStart = new Date("2030-01-03T00:00:00.000Z");
  const fixedCancelledStart = new Date("2030-01-05T00:00:00.000Z");
  const fixedHistoricalDeleted = new Date("2029-12-01T00:00:00.000Z");
  const fixedHistoricalRescheduled = new Date("2029-12-15T00:00:00.000Z");
  const recurringHistorical = new Date("2025-01-05T00:00:00.000Z");
  const jitHistoricalOne = new Date("2025-02-01T00:00:00.000Z");
  const jitHistoricalTwo = new Date("2025-02-02T00:00:00.000Z");
  const jitHistoricalThree = new Date("2025-02-03T00:00:00.000Z");
  const now = new Date("2026-01-01T00:00:00.000Z");

  const registration = (webinarId: string, index: number, selectedSession: Date | null) => {
    const id = crypto.randomUUID();
    registrationIds.push(id);
    return {
      id,
      webinarId,
      name: `Counts test ${index}`,
      email: `counts-${suffix}-${index}@example.test`,
      selectedSession,
      registeredAt: new Date("2025-01-01T00:00:00.000Z"),
    };
  };

  t.after(async () => {
    await db.delete(registrationIdentityKeys).where(inArray(registrationIdentityKeys.registrationId, registrationIds));
    await db.delete(registrations).where(inArray(registrations.id, registrationIds));
    await db.delete(webinarSessions).where(inArray(webinarSessions.id, sessionIds));
    await db.delete(webinars).where(inArray(webinars.id, allWebinarIds));
    await db.delete(users).where(inArray(users.id, [ownerId, otherOwnerId]));
  });

  await db.insert(users).values([
    {
      id: ownerId,
      username: `session-counts-owner-${suffix}`,
      password: "test-password",
      email: `session-counts-owner-${suffix}@example.test`,
      isActive: true,
    },
    {
      id: otherOwnerId,
      username: `session-counts-other-${suffix}`,
      password: "test-password",
      email: `session-counts-other-${suffix}@example.test`,
      isActive: true,
    },
  ]);

  await db.insert(webinars).values([
    {
      id: fixedWebinarId,
      userId: ownerId,
      title: "Counts fixed",
      vimeoUrl: "https://vimeo.com/counts-fixed",
      startTime: fixedMain,
      status: "live",
      scheduleMode: { recurring: false, onDemand: false, justInTime: false, justInTimeMinutes: 15 },
    },
    {
      id: recurringWebinarId,
      userId: ownerId,
      title: "Counts recurring",
      vimeoUrl: "https://vimeo.com/counts-recurring",
      startTime: recurringHistorical,
      timezone: "UTC",
      scheduleMode: {
        recurring: true,
        onDemand: false,
        justInTime: false,
        justInTimeMinutes: 15,
        eventEndDate: "2025-01-31",
      } as any,
      recurringSchedule: { enabled: true, days: [0], times: ["00:00"], excludeDates: [] },
    },
    {
      id: jitWebinarId,
      userId: ownerId,
      title: "Counts JIT",
      vimeoUrl: "https://vimeo.com/counts-jit",
      startTime: new Date("2020-01-01T00:00:00.000Z"),
      scheduleMode: { recurring: false, onDemand: false, justInTime: true, justInTimeMinutes: 15 },
    },
    {
      id: onDemandWebinarId,
      userId: ownerId,
      title: "Counts on demand",
      vimeoUrl: "https://vimeo.com/counts-on-demand",
      startTime: new Date("2020-01-01T00:00:00.000Z"),
      scheduleMode: { recurring: false, onDemand: true, justInTime: false, justInTimeMinutes: 15 },
    },
    {
      id: otherWebinarId,
      userId: otherOwnerId,
      title: "Counts other owner",
      vimeoUrl: "https://vimeo.com/counts-other",
      startTime: fixedMain,
      scheduleMode: { recurring: false, onDemand: false, justInTime: false, justInTimeMinutes: 15 },
    },
  ]);

  await db.insert(webinarSessions).values([
    {
      id: fixedDuplicateSessionId,
      webinarId: fixedWebinarId,
      scheduledStart: fixedDuplicateStart,
      status: "cancelled",
    },
    {
      id: fixedDuplicateSessionTwoId,
      webinarId: fixedWebinarId,
      scheduledStart: fixedDuplicateStart,
      status: "scheduled",
    },
    {
      id: fixedZeroSessionId,
      webinarId: fixedWebinarId,
      scheduledStart: fixedZeroStart,
      status: "scheduled",
    },
    {
      id: fixedCancelledSessionId,
      webinarId: fixedWebinarId,
      scheduledStart: fixedCancelledStart,
      status: "cancelled",
    },
  ]);

  const fixedRegistrations = [
    ...Array.from({ length: 8 }, (_, index) => registration(fixedWebinarId, index, fixedMain)),
    ...Array.from({ length: 10 }, (_, index) => registration(fixedWebinarId, index + 8, fixedDuplicateStart)),
    ...Array.from({ length: 2 }, (_, index) => registration(fixedWebinarId, index + 18, null)),
    ...Array.from({ length: 10 }, (_, index) => registration(fixedWebinarId, index + 20, fixedHistoricalDeleted)),
    ...Array.from({ length: 3 }, (_, index) => registration(fixedWebinarId, index + 30, fixedHistoricalRescheduled)),
  ];
  const recurringRegistrations = Array.from({ length: 4 }, (_, index) =>
    registration(recurringWebinarId, index + 33, recurringHistorical));
  const jitRegistrations = [
    registration(jitWebinarId, 37, jitHistoricalOne),
    registration(jitWebinarId, 38, jitHistoricalTwo),
    registration(jitWebinarId, 39, jitHistoricalThree),
  ];
  const onDemandRegistrations = [
    registration(onDemandWebinarId, 40, null),
    registration(onDemandWebinarId, 41, null),
  ];
  const otherOwnerRegistration = registration(otherWebinarId, 42, fixedMain);
  await db.insert(registrations).values([
    ...fixedRegistrations,
    ...recurringRegistrations,
    ...jitRegistrations,
    ...onDemandRegistrations,
    otherOwnerRegistration,
  ]);

  const batch = await getBatchSessionRegistrationCounts(ownerId, allWebinarIds, now);
  assert.deepEqual(Object.keys(batch).sort(), ownerWebinarIds.sort());

  const fixedCounts = batch[fixedWebinarId];
  assert.ok(fixedCounts);
  assert.equal(fixedCounts.totalRegistered, 33);
  assert.equal(sumRows(fixedCounts.counts), fixedCounts.totalRegistered);
  assert.equal(
    fixedCounts.counts.filter(row => row.key === `session-${fixedDuplicateStart.getTime()}`).length,
    1,
  );
  assert.deepEqual(
    fixedCounts.counts.find(row => row.key === `session-${fixedDuplicateStart.getTime()}`),
    {
      key: `session-${fixedDuplicateStart.getTime()}`,
      startTimeISO: fixedDuplicateStart.toISOString(),
      labelKind: "session",
      status: "scheduled",
      registrationCount: 10,
    },
  );
  assert.equal(
    fixedCounts.counts.find(row => row.key === `session-${fixedZeroStart.getTime()}`)?.registrationCount,
    0,
  );
  assert.deepEqual(
    fixedCounts.counts.find(row => row.key === `session-${fixedCancelledStart.getTime()}`),
    {
      key: `session-${fixedCancelledStart.getTime()}`,
      startTimeISO: fixedCancelledStart.toISOString(),
      labelKind: "session",
      status: "cancelled",
      registrationCount: 0,
    },
  );
  assert.equal(
    fixedCounts.counts.find(row => row.key === `session-${fixedMain.getTime()}`)?.registrationCount,
    8,
  );
  assert.equal(
    fixedCounts.counts.find(row => row.key === `session-${fixedHistoricalDeleted.getTime()}`)?.registrationCount,
    10,
  );
  assert.equal(
    fixedCounts.counts.find(row => row.key === `session-${fixedHistoricalRescheduled.getTime()}`)?.registrationCount,
    3,
  );
  assert.deepEqual(
    fixedCounts.counts.find(row => row.labelKind === "unassigned"),
    {
      key: "unassigned",
      startTimeISO: null,
      labelKind: "unassigned",
      status: "unknown",
      registrationCount: 2,
    },
  );

  const recurringCounts = batch[recurringWebinarId];
  assert.ok(recurringCounts);
  assert.equal(recurringCounts.totalRegistered, 4);
  assert.equal(sumRows(recurringCounts.counts), 4);
  assert.deepEqual(
    recurringCounts.counts.find(row => row.startTimeISO === recurringHistorical.toISOString()),
    {
      key: `recurring-${recurringHistorical.getTime()}`,
      startTimeISO: recurringHistorical.toISOString(),
      labelKind: "recurring",
      status: "ended",
      registrationCount: 4,
    },
  );

  const jitCounts = batch[jitWebinarId];
  assert.ok(jitCounts);
  assert.equal(jitCounts.totalRegistered, 3);
  assert.equal(sumRows(jitCounts.counts), 3);
  assert.deepEqual(
    jitCounts.counts.map(row => row.key),
    [
      `justInTime-${jitHistoricalOne.getTime()}`,
      `justInTime-${jitHistoricalTwo.getTime()}`,
      `justInTime-${jitHistoricalThree.getTime()}`,
    ],
  );
  assert.equal(jitCounts.counts.some(row => row.registrationCount === 0), false);

  const onDemandCounts = batch[onDemandWebinarId];
  assert.ok(onDemandCounts);
  assert.equal(onDemandCounts.totalRegistered, 2);
  assert.deepEqual(onDemandCounts.counts, [{
    key: "onDemand",
    startTimeISO: null,
    labelKind: "onDemand",
    status: "unknown",
    registrationCount: 2,
  }]);

  assert.equal(
    Object.values(batch).reduce((total, counts) => total + sumRows(counts.counts), 0),
    42,
  );

  // A batch containing another tenant's id still returns only this owner's
  // metadata and aggregates; the other owner's registration is never exposed.
  assert.equal(batch[otherWebinarId], undefined);
});

test("session registration counts route requires the owner and returns owner-scoped SQL data", async (t) => {
  assert.notEqual(process.env.NODE_ENV, "production");

  const suffix = crypto.randomUUID();
  const ownerId = crypto.randomUUID();
  const otherOwnerId = crypto.randomUUID();
  const webinarId = crypto.randomUUID();
  const webinar = {
    id: webinarId,
    userId: ownerId,
    title: "Route counts fixture",
    startTime: new Date("2030-01-01T00:00:00.000Z"),
    status: "scheduled",
    scheduleMode: { recurring: false, onDemand: false, justInTime: false, justInTimeMinutes: 15 },
  } as Webinar;
  const owner = { id: ownerId, isActive: true, isSuperAdmin: false } as User;
  const otherOwner = { id: otherOwnerId, isActive: true, isSuperAdmin: false } as User;
  const originals = {
    getWebinar: storage.getWebinar,
    getUser: storage.getUser,
  };

  t.after(async () => {
    storage.getWebinar = originals.getWebinar;
    storage.getUser = originals.getUser;
    await db.delete(webinars).where(eq(webinars.id, webinarId));
    await db.delete(users).where(inArray(users.id, [ownerId, otherOwnerId]));
  });

  await db.insert(users).values([
    {
      id: ownerId,
      username: `session-counts-route-owner-${suffix}`,
      password: "test-password",
      email: `session-counts-route-owner-${suffix}@example.test`,
      isActive: true,
    },
    {
      id: otherOwnerId,
      username: `session-counts-route-other-${suffix}`,
      password: "test-password",
      email: `session-counts-route-other-${suffix}@example.test`,
      isActive: true,
    },
  ]);
  await db.insert(webinars).values({
    id: webinarId,
    userId: ownerId,
    title: webinar.title,
    vimeoUrl: "https://vimeo.com/counts-route",
    startTime: webinar.startTime,
    status: webinar.status,
    scheduleMode: webinar.scheduleMode,
  });

  storage.getWebinar = async id => id === webinarId ? webinar : undefined;
  storage.getUser = async id => id === ownerId ? owner : id === otherOwnerId ? otherOwner : undefined;

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = req.header("x-test-user");
    (req as any).session = userId ? { userId } : {};
    next();
  });
  const server = createServer(app);
  await registerRoutes(server, app, undefined, { startScheduler: () => {} });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}/api/webinars/${webinarId}/session-registration-counts`;

  t.after(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });

  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url, { headers: { "x-test-user": otherOwnerId } })).status, 403);
  const ownerResponse = await fetch(url, { headers: { "x-test-user": ownerId } });
  assert.equal(ownerResponse.status, 200);
  const ownerCounts = await ownerResponse.json() as { totalRegistered: number };
  assert.equal(ownerCounts.totalRegistered, 0);
});