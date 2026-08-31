import assert from "node:assert/strict";
import test from "node:test";
import { canViewWebinar } from "./webinarAccess";

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