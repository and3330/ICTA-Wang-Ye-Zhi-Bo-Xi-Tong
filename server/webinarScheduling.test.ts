import assert from "node:assert/strict";
import test from "node:test";
import { insertRegistrationSchema, type Webinar, type WebinarSession } from "@shared/schema";
import {
  getAvailableSessions,
  generateRecurringSessions,
  isValidIanaTimezone,
  normalizeSelectedSession,
  scheduleDateBounds,
  zonedDateTimeToDate,
} from "./webinarScheduling";

function webinar(overrides: Partial<Webinar> = {}): Webinar {
  return {
    id: "webinar-a",
    title: "Scheduling test",
    startTime: new Date("2026-04-10T12:00:00.000Z"),
    timezone: "America/New_York",
    scheduleMode: { recurring: true, onDemand: true, justInTime: false, justInTimeMinutes: 15 },
    recurringSchedule: { enabled: true, days: [0], times: ["09:00"], excludeDates: [] },
    ...overrides,
  } as Webinar;
}

test("hybrid availability adds persisted sessions to recurring and on-demand choices", () => {
  const persisted = [{
    id: "persisted",
    webinarId: "webinar-a",
    scheduledStart: new Date("2026-03-10T18:00:00.000Z"),
    status: "scheduled",
  }] as WebinarSession[];
  const result = getAvailableSessions(
    webinar(),
    persisted,
    new Date("2026-03-07T12:00:00.000Z"),
  );
  assert.equal(result.mode, "recurring");
  assert.equal(result.onDemandAvailable, true);
  assert.ok(result.sessions.some((session) => session.id === "persisted"));
  assert.ok(result.sessions.some((session) => session.id.startsWith("recurring-")));
});

test("recurring civil times use the webinar timezone across DST", () => {
  assert.equal(
    zonedDateTimeToDate(2026, 3, 8, 2, 30, "America/New_York"),
    null,
    "spring-forward gap is not silently shifted",
  );
  assert.equal(
    zonedDateTimeToDate(2026, 3, 15, 9, 0, "America/New_York")?.toISOString(),
    "2026-03-15T13:00:00.000Z",
  );
  const result = getAvailableSessions(
    webinar({ recurringSchedule: { enabled: true, days: [0], times: ["02:30"], excludeDates: [] } }),
    [],
    new Date("2026-03-07T12:00:00.000Z"),
  );
  assert.equal(result.sessions[0].scheduledStart.toISOString(), "2026-03-15T06:30:00.000Z");
});

test("biweekly recurrence deterministically skips alternating anchored weeks", () => {
  const recurring = webinar({
    startTime: new Date("2026-03-01T14:00:00.000Z"),
    recurringSchedule: {
      enabled: true,
      frequency: "biweekly",
      days: [0],
      times: ["09:00"],
      excludeDates: [],
    } as any,
  });
  const firstRun = generateRecurringSessions(recurring, new Date("2026-03-01T00:00:00.000Z"), 30);
  const laterRun = generateRecurringSessions(recurring, new Date("2026-03-08T00:00:00.000Z"), 30);

  assert.deepEqual(
    firstRun.slice(0, 3).map((session) => session.scheduledStart.toISOString()),
    ["2026-03-01T14:00:00.000Z", "2026-03-15T13:00:00.000Z", "2026-03-29T13:00:00.000Z"],
  );
  assert.equal(laterRun[0].scheduledStart.toISOString(), "2026-03-15T13:00:00.000Z");
});

test("recurring availability enforces valid webinar-local event date bounds", () => {
  const result = getAvailableSessions(
    webinar({ scheduleMode: { recurring: true, onDemand: false, justInTime: false, justInTimeMinutes: 15, eventStartDate: "2026-03-15", eventEndDate: "2026-03-15" } as any }),
    [],
    new Date("2026-03-07T12:00:00.000Z"),
  );
  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0].scheduledStart.toISOString(), "2026-03-15T13:00:00.000Z");
  assert.throws(
    () => scheduleDateBounds({ eventStartDate: "2026-02-30" }),
    /valid calendar date/,
  );
  assert.throws(
    () => scheduleDateBounds({ eventStartDate: "2026-03-20", eventEndDate: "2026-03-01" }),
    /on or before/,
  );
});

test("selected sessions are exact eligible instants and reject stale or arbitrary dates", () => {
  const now = new Date("2026-03-07T12:00:00.000Z");
  const availability = getAvailableSessions(webinar(), [], now);
  const selectable = availability.sessions[0].scheduledStart;
  assert.equal(normalizeSelectedSession(selectable.toISOString(), availability, now)?.getTime(), selectable.getTime());
  assert.throws(
    () => normalizeSelectedSession("2026-03-09T12:34:56.000Z", availability, now),
    /不屬於/,
  );
  assert.throws(
    () => normalizeSelectedSession("2020-01-01T00:00:00.000Z", availability, now),
    /已過期/,
  );
});

test("a session from another webinar is not eligible", () => {
  const now = new Date("2026-03-07T12:00:00.000Z");
  const wrongSession = [{
    id: "wrong",
    webinarId: "webinar-b",
    scheduledStart: new Date("2026-03-10T18:00:00.000Z"),
    status: "scheduled",
  }] as WebinarSession[];
  const availability = getAvailableSessions(
    webinar({ recurringSchedule: null, scheduleMode: { recurring: false, onDemand: false, justInTime: false, justInTimeMinutes: 15 } }),
    wrongSession,
    now,
  );
  assert.throws(
    () => normalizeSelectedSession(wrongSession[0].scheduledStart, availability, now),
    /不屬於/,
  );
});

test("session omission is allowed only for on-demand registration", () => {
  const now = new Date("2026-03-07T12:00:00.000Z");
  const hybrid = getAvailableSessions(webinar(), [], now);
  assert.equal(normalizeSelectedSession(undefined, hybrid, now), null);
  const scheduledOnly = getAvailableSessions(
    webinar({ scheduleMode: { recurring: true, onDemand: false, justInTime: false, justInTimeMinutes: 15 } }),
    [],
    now,
  );
  assert.throws(() => normalizeSelectedSession(undefined, scheduledOnly, now), /請選擇/);
  assert.equal(isValidIanaTimezone("America/New_York"), true);
  assert.equal(isValidIanaTimezone("UTC"), true);
  assert.equal(isValidIanaTimezone("Not/A_Real_Zone"), false);
  const registration = { webinarId: "webinar-a", name: "Viewer", email: "viewer@example.com" };
  assert.equal(insertRegistrationSchema.safeParse({ ...registration, viewerTimezone: "Asia/Taipei" }).success, true);
  assert.equal(insertRegistrationSchema.safeParse({ ...registration, viewerTimezone: "Not/A_Real_Zone" }).success, false);
});

test("expired fixed webinars are closed instead of masquerading as on-demand", () => {
  const availability = getAvailableSessions(
    webinar({
      startTime: new Date("2026-03-01T12:00:00.000Z"),
      scheduleMode: { recurring: false, onDemand: false, justInTime: false, justInTimeMinutes: 15 },
      recurringSchedule: null,
    }),
    [],
    new Date("2026-03-07T12:00:00.000Z"),
  );

  assert.equal(availability.mode, "fixed");
  assert.equal(availability.onDemandAvailable, false);
  assert.equal(availability.registrationOpen, false);
  assert.deepEqual(availability.sessions, []);
});