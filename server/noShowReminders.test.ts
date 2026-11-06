import assert from "node:assert/strict";
import test from "node:test";
import type { EmailReminder, Registration, Webinar } from "@shared/schema";
import { canSendNoShowReminder } from "@shared/email-reminders";
import { buildDeferredEmail, createEmailRemindersForRegistration, shouldDeliverNoShowReminder } from "./email-scheduler";
import { storage } from "./storage";
import { verifyWatchTokenFor } from "./watchTokens";

const start = new Date("2030-01-01T11:30:00Z");
const atTen = new Date(start.getTime() + 600_000);
function fixture() {
  return {
    registration: {
      id: "no-show-reg", webinarId: "no-show-webinar", name: "Viewer", email: "nobody@example.test",
      selectedSession: start, attended: false, attendedAt: null, watchDuration: 0, deletedAt: null,
    } as Registration,
    webinar: { id: "no-show-webinar", title: "提醒測試", timezone: "Asia/Taipei", videoDuration: 3600, emailSettings: {
      confirmationEnabled: false, reminder1hEnabled: false, reminder24hEnabled: false,
      reminder5mEnabled: false, reminderStartEnabled: false, reminderNoShow10mEnabled: true,
      followUpEnabled: false, customSubject: "", customTemplate: "",
    } } as Webinar,
  };
}

test("no-show eligibility is limited to a scheduled, unvisited, live session after ten minutes", () => {
  const { registration: r, webinar: w } = fixture();
  assert.equal(canSendNoShowReminder(r, w, new Date(atTen.getTime() - 1)), false);
  assert.equal(canSendNoShowReminder(r, w, atTen), true);
  assert.equal(canSendNoShowReminder({ ...r, attended: true }, w, atTen), false);
  assert.equal(canSendNoShowReminder({ ...r, attendedAt: start }, w, atTen), false);
  assert.equal(canSendNoShowReminder({ ...r, watchDuration: 1 }, w, atTen), false);
  assert.equal(canSendNoShowReminder({ ...r, deletedAt: start }, w, atTen), false);
  assert.equal(canSendNoShowReminder({ ...r, selectedSession: null }, w, atTen), false);
  assert.equal(canSendNoShowReminder(r, { videoDuration: 300 }, atTen), false);
  assert.equal(canSendNoShowReminder(r, w, new Date(start.getTime() + 3_600_000)), false);
});

test("no-show reminders queue once at selected-session plus ten minutes, with opt-out and on-demand exclusions", async (t) => {
  const { registration: r, webinar: w } = fixture();
  const original = storage.createEmailReminder;
  const created: any[] = [];
  storage.createEmailReminder = async value => { created.push(value); return value as any; };
  t.after(() => { storage.createEmailReminder = original; });
  await createEmailRemindersForRegistration(r, w, "https://example.test", "not-a-real-token");
  assert.equal(created.length, 1);
  assert.equal(created[0].reminderType, "reminder_no_show_10m");
  assert.equal(created[0].scheduledFor.getTime(), atTen.getTime());
  created.length = 0;
  await createEmailRemindersForRegistration({ ...r, attended: true }, w, "https://example.test", "test-only");
  await createEmailRemindersForRegistration({ ...r, selectedSession: null }, w, "https://example.test", "test-only");
  await createEmailRemindersForRegistration(r, { ...w, videoDuration: 300 }, "https://example.test", "test-only");
  await createEmailRemindersForRegistration(r, { ...w, emailSettings: { ...w.emailSettings!, reminderNoShow10mEnabled: false } }, "https://example.test", "test-only");
  await createEmailRemindersForRegistration({ ...r, selectedSession: new Date(Date.now() - 660_000) }, w, "https://example.test", "test-only");
  assert.deepEqual(created, []);
});

test("delivery re-reads attendance and checks repeat registrations immediately before sending", async (t) => {
  const { registration: r, webinar: w } = fixture();
  const getRegistration = storage.getRegistration;
  const hasAttendedSession = storage.hasAttendedSession;
  let latest: Registration | undefined = r;
  let repeatAttended = false;
  let reads = 0;
  storage.getRegistration = async () => { reads++; return latest; };
  storage.hasAttendedSession = async () => repeatAttended;
  t.after(() => { storage.getRegistration = getRegistration; storage.hasAttendedSession = hasAttendedSession; });
  assert.equal(await shouldDeliverNoShowReminder(r.id, w, atTen), true);
  latest = { ...r, attended: true };
  assert.equal(await shouldDeliverNoShowReminder(r.id, w, atTen), false);
  latest = r;
  repeatAttended = true;
  assert.equal(await shouldDeliverNoShowReminder(r.id, w, atTen), false);
  repeatAttended = false;
  latest = { ...r, webinarId: "another-webinar" };
  assert.equal(await shouldDeliverNoShowReminder(r.id, w, atTen), false);
  latest = undefined;
  assert.equal(await shouldDeliverNoShowReminder(r.id, w, atTen), false);
  latest = r;
  assert.equal(await shouldDeliverNoShowReminder(r.id, w, new Date(start.getTime() + 3_600_000)), false);
  assert.equal(reads, 6);
});

test("no-show email says now is still in time and includes only the registrant's verified watch link", () => {
  const { registration: r, webinar: w } = fixture();
  const previous = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "no-show-test-only-secret";
  try {
    const email = buildDeferredEmail({ reminderType: "reminder_no_show_10m" } as EmailReminder, r, w, "https://example.test");
    assert.match(email.subject, /現在加入還來得及/);
    assert.match(email.html, /現在加入還來得及/);
    assert.match(email.html, /Asia\/Taipei/);
    const match = /watchToken=([^"'&<\s]+)/.exec(email.html);
    assert.ok(match);
    const token = decodeURIComponent(match[1]);
    assert.ok(verifyWatchTokenFor(token, r.id, w.id));
    assert.equal(verifyWatchTokenFor(token, "another-registration", w.id), null);
    assert.equal(verifyWatchTokenFor(token, r.id, "another-webinar"), null);
  } finally {
    if (previous === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previous;
  }
});
