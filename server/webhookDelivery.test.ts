import assert from "node:assert/strict";
import test from "node:test";
import https from "node:https";
import { assertSafeWebhookUrl, pinnedLookup, WEBHOOK_DELIVERY_DEADLINE_MS, WEBHOOK_LEASE_MS } from "./webhookDelivery";

test("webhook destinations reject local, private, credentialed, and insecure URLs", async () => {
  const rejected = [
    "http://example.com/hook",
    "https://localhost/hook",
    "https://127.0.0.1/hook",
    "https://10.1.2.3/hook",
    "https://[::1]/hook",
    "https://user:pass@example.com/hook",
    "https://example.com:8443/hook",
  ];
  for (const url of rejected) {
    await assert.rejects(assertSafeWebhookUrl(url));
  }
});

test("pinned lookup satisfies the Node https.request all-address contract", async () => {
  const error = await new Promise<NodeJS.ErrnoException>((resolve, reject) => {
    const request = https.request({
      hostname: "must-not-resolve.invalid",
      port: 9,
      method: "POST",
      autoSelectFamily: true,
      lookup: pinnedLookup("127.0.0.1", 4),
      rejectUnauthorized: false,
    });
    request.setTimeout(2_000, () => request.destroy(new Error("test timeout")));
    request.once("error", resolve);
    request.once("response", () => reject(new Error("unexpected response")));
    request.end();
  });
  assert.notEqual(error.code, "ERR_INVALID_IP_ADDRESS");
  assert.match(String(error.code || error.message), /ECONNREFUSED|ECONNRESET|EACCES/);
});

test("webhook lease strictly exceeds the whole redirect delivery deadline", () => {
  assert.ok(WEBHOOK_LEASE_MS > WEBHOOK_DELIVERY_DEADLINE_MS);
});