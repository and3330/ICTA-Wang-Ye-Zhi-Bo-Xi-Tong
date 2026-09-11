import test from "node:test";
import assert from "node:assert/strict";
import { optionalRegistrationEnrichment } from "./externalJourneySafety";

test("optional registration enrichment cannot fail an already-persisted response", async () => {
  const result = await optionalRegistrationEnrichment(async () => { throw new Error("database unavailable"); });
  assert.deepEqual(result, { available: false });
});

test("optional registration enrichment retains successful result", async () => {
  const result = await optionalRegistrationEnrichment(async () => ({ redirectUrl: "https://example.test/thanks" }));
  assert.deepEqual(result, { available: true, value: { redirectUrl: "https://example.test/thanks" } });
});