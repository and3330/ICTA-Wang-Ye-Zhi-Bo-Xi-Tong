import assert from "node:assert/strict";
import test from "node:test";
import { createRawToken, hashToken, safeErrorText } from "./security";

test("authentication tokens are random and only deterministically hash", () => {
  const first = createRawToken();
  const second = createRawToken();
  assert.notEqual(first, second);
  assert.ok(first.length >= 40);
  assert.match(hashToken(first), /^[a-f0-9]{64}$/);
  assert.equal(hashToken(first), hashToken(first));
  assert.notEqual(hashToken(first), first);
});

test("error sanitization removes credentials and token query values", () => {
  const sanitized = safeErrorText(
    "Bearer secret-value https://example.test/reset?token=raw-token&password=hunter2 sk_live_abcdefghijklmnop",
  );
  assert.doesNotMatch(sanitized, /secret-value|raw-token|hunter2|sk_live/);
  assert.match(sanitized, /\[REDACTED\]/);
});