import assert from "node:assert/strict";
import test from "node:test";
import { canRetainViewerWsAccess, canViewWebinar, webinarWatchEligibility } from "./webinarAccess";

test("anonymous viewers cannot join or fetch a draft webinar", () => {
  assert.equal(canViewWebinar({ userId: "owner", publishStatus: "draft" }, null), false);
});

test("a webinar owner can preview their draft over HTTP or WebSocket", () => {
  assert.equal(canViewWebinar({ userId: "owner", publishStatus: "draft" }, "owner"), true);
});

test("non-owners cannot preview drafts, while published webinars remain public", () => {
  assert.equal(canViewWebinar({ userId: "owner", publishStatus: "draft" }, "other"), false);
  assert.equal(canViewWebinar({ userId: "owner", publishStatus: "published" }, null), true);
});

test("super admins may inspect drafts without granting ordinary cross-tenant access", () => {
  const draft = { userId: "owner", publishStatus: "draft" };
  assert.equal(canViewWebinar(draft, "super", true), true);
  assert.equal(canViewWebinar(draft, "tenant-b", false), false);
});

test("viewer websocket access is revoked immediately when its webinar is unpublished", () => {
  assert.equal(canRetainViewerWsAccess("published", true, true), true);
  assert.equal(canRetainViewerWsAccess("draft", true, true), false);
});

test("replay starts after video completion and ends at the configured deadline", () => {
  const start = new Date("2026-01-01T00:00:00Z");
  const webinar = { status: "ended", videoDuration: 3600, replayEnabled: true, replayAvailableHours: 2 };
  assert.equal(webinarWatchEligibility(webinar, { selectedSession: start }, start.getTime() - 1).canWatch, false);
  assert.equal(webinarWatchEligibility(webinar, { selectedSession: start }, start.getTime() + 3 * 3600_000).canWatch, true);
  assert.equal(webinarWatchEligibility(webinar, { selectedSession: start }, start.getTime() + 3 * 3600_000 + 1).canWatch, false);
  assert.equal(webinarWatchEligibility({ ...webinar, replayEnabled: false }, { selectedSession: start }, start.getTime() + 3600_000 + 1).canWatch, false);
});