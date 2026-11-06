import assert from "node:assert/strict";
import test from "node:test";
import type { EmailReminder, EmailSequence, Registration, Webinar } from "@shared/schema";
import {
  buildDeferredEmail,
  renderEmail,
  createEmailRemindersForRegistration,
  EMAIL_CLAIM_BATCH_SIZE,
  EMAIL_LEASE_MS,
  EMAIL_MAX_BATCHES_PER_TICK,
  EMAIL_PROVIDER_DEADLINE_MS,
} from "./email-scheduler";
import { storage } from "./storage";
import { verifyWatchTokenFor } from "./watchTokens";

function webinar(): Webinar {
  return {
    id: "email-webinar",
    title: "Email timing",
    startTime: new Date("2030-01-01T00:00:00.000Z"),
    videoDuration: 3600,
    timezone: "UTC",
    emailSettings: {
      confirmationEnabled: false,
      reminder24hEnabled: true,
      reminder1hEnabled: true,
      followUpEnabled: true,
      customSubject: "",
      customTemplate: "",
    },
  } as Webinar;
}

test("scheduler burst policy drains hundreds concurrently inside fenced leases", () => {
  assert.equal(EMAIL_CLAIM_BATCH_SIZE * EMAIL_MAX_BATCHES_PER_TICK, 500);
  assert.ok(EMAIL_LEASE_MS > EMAIL_PROVIDER_DEADLINE_MS);
  assert.ok(EMAIL_CLAIM_BATCH_SIZE >= 20);
});

test("reminders are based on the registration's selected session", async (t) => {
  const original = storage.createEmailReminder;
  const created: any[] = [];
  storage.createEmailReminder = async (value) => {
    created.push(value);
    return value as any;
  };
  t.after(() => { storage.createEmailReminder = original; });

  const selected = new Date(Date.now() + 72 * 60 * 60 * 1000);
  await createEmailRemindersForRegistration({
    id: "registration",
    name: "Viewer",
    email: "viewer@example.com",
    selectedSession: selected,
  } as Registration, webinar(), "https://example.com", "test-watch-token");

  assert.equal(created.find((item) => item.reminderType === "reminder_24h").scheduledFor.getTime(), selected.getTime() - 24 * 60 * 60 * 1000);
  assert.equal(created.find((item) => item.reminderType === "reminder_1h").scheduledFor.getTime(), selected.getTime() - 60 * 60 * 1000);
  assert.equal(created.find((item) => item.reminderType === "reminder_5m").scheduledFor.getTime(), selected.getTime() - 5 * 60 * 1000);
  assert.equal(created.find((item) => item.reminderType === "reminder_start").scheduledFor.getTime(), selected.getTime());
  assert.equal(created.find((item) => item.reminderType === "reminder_no_show_10m").scheduledFor.getTime(), selected.getTime() + 10 * 60 * 1000);
  assert.equal(created.find((item) => item.reminderType === "followup").scheduledFor.getTime(), selected.getTime() + 90 * 60 * 1000);
});

test("immediate on-demand registration creates no timed reminders or follow-up", async (t) => {
  const original = storage.createEmailReminder;
  const created: any[] = [];
  storage.createEmailReminder = async (value) => {
    created.push(value);
    return value as any;
  };
  t.after(() => { storage.createEmailReminder = original; });

  await createEmailRemindersForRegistration({
    id: "registration",
    name: "Viewer",
    email: "viewer@example.com",
    selectedSession: null,
  } as Registration, webinar(), "https://example.com", "test-watch-token");
  assert.deepEqual(created, []);
});

function tokenFromHtml(html: string): string {
  const match = /watchToken=([^"'&<\s]+)/.exec(html);
  assert.ok(match, "email HTML should contain a watch token");
  return decodeURIComponent(match[1]);
}

test("late registrations get only the remaining start reminders and respect opt-outs", async (t) => {
  const original = storage.createEmailReminder;
  const created: any[] = [];
  storage.createEmailReminder = async value => { created.push(value); return value as any; };
  t.after(() => { storage.createEmailReminder = original; });
  const registration = {
    id: "late", name: "Viewer", email: "viewer@example.test",
    selectedSession: new Date(Date.now() + 120_000),
  } as Registration;
  const w = webinar();
  w.emailSettings = { ...w.emailSettings!, followUpEnabled: false, reminderNoShow10mEnabled: false };
  await createEmailRemindersForRegistration(registration, w, "https://example.com", "test-only");
  assert.deepEqual(created.map(item => item.reminderType), ["reminder_start"]);

  created.length = 0;
  registration.selectedSession = new Date(Date.now() - 11 * 60_000);
  await createEmailRemindersForRegistration(registration, w, "https://example.com", "test-only");
  assert.deepEqual(created, [], "past reminder times must never be sent retrospectively");

  registration.selectedSession = new Date(Date.now() + 600_000);
  w.emailSettings.reminder1hEnabled = false;
  await createEmailRemindersForRegistration(registration, w, "https://example.com", "test-only");
  assert.deepEqual(created, [], "legacy timed-reminder opt-out remains effective");

  w.emailSettings.reminder5mEnabled = true;
  w.emailSettings.reminderStartEnabled = false;
  await createEmailRemindersForRegistration(registration, w, "https://example.com", "test-only");
  assert.deepEqual(created.map(item => item.reminderType), ["reminder_5m"]);
  created.length = 0;
  w.emailSettings.reminder5mEnabled = false;
  w.emailSettings.reminderStartEnabled = true;
  await createEmailRemindersForRegistration(registration, w, "https://example.com", "test-only");
  assert.deepEqual(created.map(item => item.reminderType), ["reminder_start"]);
});

test("five-minute and starting emails have distinct text, Taipei time and scoped watch links", () => {
  const previous = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "start-reminder-test-only-secret";
  try {
    const w = { ...webinar(), timezone: "Asia/Taipei" };
    const registration = {
      id: "start-registration", name: "Viewer", email: "viewer@example.test",
      selectedSession: new Date("2030-01-01T11:30:00.000Z"),
    } as Registration;
    for (const kind of ["reminder_5m", "reminder_start"]) {
      const built = buildDeferredEmail({ reminderType: kind } as EmailReminder, registration, w, "https://example.com");
      assert.match(built.subject, kind === "reminder_5m" ? /5 分鐘後開播/ : /現在開播/);
      assert.match(built.html, /Asia\/Taipei/);
      assert.match(built.html, /07:30|19:30/);
      const token = tokenFromHtml(built.html);
      assert.ok(verifyWatchTokenFor(token, registration.id, w.id));
      assert.equal(verifyWatchTokenFor(token, "another-registration", w.id), null);
    }
  } finally {
    if (previous === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previous;
  }
});

test("deferred standard reminder contains a registration-scoped watch URL", () => {
  const previous = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "deferred-email-test-secret";
  try {
    const registration = {
      id: "registration-a",
      webinarId: "email-webinar",
      name: "Viewer",
      email: "viewer@example.com",
      selectedSession: new Date(Date.now() + 60_000),
    } as Registration;
    const reminder = {
      id: "reminder-a",
      webinarId: "email-webinar",
      registrationId: registration.id,
      reminderType: "reminder_1h",
    } as EmailReminder;
    const built = buildDeferredEmail(reminder, registration, webinar(), "https://example.com");
    const token = tokenFromHtml(built.html);
    assert.ok(verifyWatchTokenFor(token, registration.id, registration.webinarId));
    assert.equal(verifyWatchTokenFor(token, "registration-b", registration.webinarId), null);
    assert.equal(verifyWatchTokenFor(token, registration.id, "webinar-b"), null);
  } finally {
    if (previous === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previous;
  }
});

test("deferred sequence template receives a registration-scoped watch URL", () => {
  const previous = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "deferred-sequence-test-secret";
  try {
    const registration = {
      id: "registration-sequence",
      webinarId: "email-webinar",
      name: "Viewer",
      email: "viewer@example.com",
      selectedSession: new Date(Date.now() + 60_000),
    } as Registration;
    const reminder = {
      id: "reminder-sequence",
      webinarId: "email-webinar",
      registrationId: registration.id,
      reminderType: "sequence",
      sequenceId: "sequence-a",
    } as EmailReminder;
    const sequence = {
      id: "sequence-a",
      webinarId: "email-webinar",
      name: "Follow-up",
      subject: "Your link",
      htmlBody: '<a href="{{url}}">Watch</a>',
      segment: "all",
      delayMinutes: 0,
      enabled: true,
    } as EmailSequence;
    const built = buildDeferredEmail(reminder, registration, webinar(), "https://example.com", sequence);
    const token = tokenFromHtml(built.html);
    assert.ok(verifyWatchTokenFor(token, registration.id, registration.webinarId));
    assert.equal(verifyWatchTokenFor(token, "another-registration", registration.webinarId), null);
    assert.equal(verifyWatchTokenFor(token, registration.id, "another-webinar"), null);
  } finally {
    if (previous === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previous;
  }
});
test("sales link variable uses the CTA page and falls back to the viewer's room", () => {
  const webinar = { title: "課程說明會", timezone: "Asia/Taipei", emailSettings: {} } as any;
  const base = {
    kind: "sequence",
    name: "王小明",
    webinar,
    startTime: new Date("2026-12-01T12:00:00Z"),
    onDemand: false,
    webinarUrl: "https://app.test/webinar/w1?watchToken=abc",
    sequence: { subject: "{{name}} 的優惠", htmlBody: '<a href="{{cta_url}}">報名</a> <a href="{{url}}">回放</a>' },
  };
  const withCta = renderEmail({ ...base, ctaUrl: "https://shop.test/course" });
  assert.equal(withCta.subject, "王小明 的優惠");
  assert.match(withCta.html, /href="https:\/\/shop\.test\/course">報名/);
  assert.match(withCta.html, /href="https:\/\/app\.test\/webinar\/w1\?watchToken=abc">回放/);
  const withoutCta = renderEmail({ ...base, ctaUrl: null });
  assert.match(withoutCta.html, /href="https:\/\/app\.test\/webinar\/w1\?watchToken=abc">報名/);
});
