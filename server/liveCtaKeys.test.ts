import assert from "node:assert/strict";
import test from "node:test";
import { createLiveCtaKey, verifyLiveCtaKey } from "./liveCtaKeys";

test("live CTA keys are URL-safe, signed, webinar-bound, and expire", () => {
  const secret = "unit-test-session-secret";
  const issued = new Date("2031-03-01T12:00:00.000Z");
  const key = createLiveCtaKey("webinar-a", secret, {
    now: issued,
    expiresAt: new Date("2031-03-01T12:10:00.000Z"),
  });
  assert.match(key, /^[A-Za-z0-9_-]{1,64}$/);
  assert.equal(verifyLiveCtaKey(key, "webinar-a", secret, new Date("2031-03-01T12:05:00.000Z")), true);
  assert.equal(verifyLiveCtaKey(key, "webinar-b", secret, new Date("2031-03-01T12:05:00.000Z")), false);
  assert.equal(verifyLiveCtaKey(key, "webinar-a", secret, new Date("2031-03-01T12:11:00.000Z")), false);

  const forgedIndex = Math.floor(key.length / 2);
  const forged = `${key.slice(0, forgedIndex)}${key[forgedIndex] === "A" ? "B" : "A"}${key.slice(forgedIndex + 1)}`;
  assert.equal(verifyLiveCtaKey(forged, "webinar-a", secret, new Date("2031-03-01T12:05:00.000Z")), false);
});