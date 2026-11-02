import assert from "node:assert/strict";
import test from "node:test";
import { createJitSelectionToken, createWatchToken, verifyJitSelectionToken, verifyWatchToken, watchTokenExpiry, viewerChatSessionId } from "./watchTokens";

test("chat identities are stable within a verified registration and isolated across people and webinars", () => {
  const previous = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "test-chat-isolation-only";
  try {
    const a = viewerChatSessionId("webinar-a", "registration:a");
    assert.equal(a, viewerChatSessionId("webinar-a", "registration:a"));
    assert.notEqual(a, viewerChatSessionId("webinar-a", "registration:b"));
    assert.notEqual(a, viewerChatSessionId("webinar-b", "registration:a"));
    assert.notEqual(a, viewerChatSessionId("webinar-a", "preview:owner:a"));
  } finally {
    if (previous === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previous;
  }
});

test("watch tokens are signed, scoped, and reject tampering", () => {
  const previous = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "test-secret";
  try {
    const token = createWatchToken("registration-a", "webinar-a");
    assert.deepEqual(verifyWatchToken(token), {
      v: 1, registrationId: "registration-a", webinarId: "webinar-a",
      exp: verifyWatchToken(token)!.exp,
    });
    assert.equal(verifyWatchToken(`${token}x`), null);
    assert.equal(verifyWatchToken("not.a.token"), null);
    assert.equal(verifyWatchToken(createWatchToken("registration-a", "webinar-a", Date.now() - 1)), null);
  } finally {
    if (previous === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previous;
  }
});

test("JIT selection token only accepts its exact issued slot", () => {
  const previous = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "test-secret";
  try {
    const slot = new Date(Date.now() + 60_000);
    const token = createJitSelectionToken("webinar-a", slot);
    assert.equal(verifyJitSelectionToken(token, "webinar-a")?.getTime(), slot.getTime());
    assert.equal(verifyJitSelectionToken(token, "webinar-b"), null);
    assert.equal(verifyJitSelectionToken(`${token}x`, "webinar-a"), null);
    assert.ok(verifyWatchToken(createWatchToken("registration-a", "webinar-a", watchTokenExpiry(new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), 48)))!.exp > Date.now() + 90 * 24 * 60 * 60 * 1000);
    // The token remains valid at least until the issued start, unlike a
    // fixed 10-minute token for a 15-minute JIT wait.
    const jitPayload = JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString("utf8"));
    assert.ok(jitPayload.exp >= slot.getTime() + 15 * 60 * 1000);
  } finally {
    if (previous === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previous;
  }
});