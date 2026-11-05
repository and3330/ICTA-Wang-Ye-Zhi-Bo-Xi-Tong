import test from "node:test";
import assert from "node:assert/strict";
import { scoreLeadInsight, buildLeadInsights } from "./leadInsights";
import type { Registration, WebinarFunnelEvent } from "@shared/schema";

const registration = { id: "r1", registeredAt: new Date("2025-01-01T00:00:00Z") } as Registration;
function event(eventType: WebinarFunnelEvent["eventType"], at: string, extra: Partial<WebinarFunnelEvent> = {}): WebinarFunnelEvent {
  return { id: `${eventType}-${at}`, webinarId: "w", eventType, registrationId: "r1", sessionId: null, ctaId: null, ctaKey: null, offerId: null, visitorTokenHash: null, positionSeconds: null, value: null, amountMinor: null, currency: null, dedupeKey: `${eventType}-${at}`, metadata: {}, occurredAt: new Date(at), ...extra };
}

test("deduplicates repeated CTA and progress scoring", () => {
  const insight = scoreLeadInsight(registration, [
    event("webinar_enter", "2025-01-01T01:00:00Z"),
    event("video_progress", "2025-01-01T01:01:00Z", { metadata: { progressPercent: 20 } }),
    event("video_progress", "2025-01-01T01:02:00Z", { metadata: { progressPercent: 80 } }),
    event("video_progress", "2025-01-01T01:03:00Z", { metadata: { progressPercent: 80 } }),
    event("cta_view", "2025-01-01T01:04:00Z"), event("cta_view", "2025-01-01T01:05:00Z"),
  ], 600);
  assert.equal(insight.score, 41);
  assert.equal(insight.evidence.filter(e => e.type === "cta_view").length, 1);
  assert.equal(insight.evidence.find(e => e.type === "video_progress")?.points, 16);
});

test("uses maximum progress and duration fallback", () => {
  const insight = scoreLeadInsight(registration, [
    event("video_progress", "2025-01-01T01:00:00Z", { positionSeconds: 50 }),
    event("video_progress", "2025-01-01T01:01:00Z", { metadata: { progressPercent: 30 }, positionSeconds: 500 }),
  ], 100);
  assert.equal(insight.score, 20);
});

test("transitions stages and purchase forces customer score", () => {
  const base = [event("webinar_enter", "2025-01-01T01:00:00Z"), event("cta_click", "2025-01-01T01:01:00Z"), event("checkout_start", "2025-01-01T01:02:00Z")];
  assert.equal(scoreLeadInsight(registration, base).stage, "checkout");
  const purchased = scoreLeadInsight(registration, [...base, event("purchase", "2025-01-01T01:03:00Z", { amountMinor: 10000, currency: "TWD" })]);
  assert.equal(purchased.stage, "converted");
  assert.equal(purchased.temperature, "customer");
  assert.equal(purchased.score, 100);
});

test("refund ordering only suppresses a purchase that precedes it", () => {
  const before = scoreLeadInsight(registration, [event("refund", "2025-01-01T01:02:00Z"), event("purchase", "2025-01-01T01:03:00Z")]);
  assert.equal(before.stage, "registered");
  const after = scoreLeadInsight(registration, [event("purchase", "2025-01-01T01:02:00Z"), event("refund", "2025-01-01T01:03:00Z")]);
  assert.equal(after.stage, "registered");
});

test("uses financial amounts for equal-time refunds, partial refunds, and repurchases", () => {
  const at = "2025-01-01T01:02:00Z";
  const purchase = event("purchase", at, { amountMinor: 10000, currency: "TWD" });
  const fullRefund = event("refund", at, { id: "refund-equal-time", amountMinor: 10000, currency: "TWD" });
  const fullyRefunded = scoreLeadInsight(registration, [fullRefund, purchase]);
  assert.equal(fullyRefunded.stage, "refunded");
  assert.equal(fullyRefunded.score, 0);
  assert.equal(fullyRefunded.suppressSalesFollowUp, true);

  const partialRefund = event("refund", "2025-01-01T01:03:00Z", { amountMinor: 3000, currency: "TWD" });
  const partiallyRefunded = scoreLeadInsight(registration, [purchase, partialRefund]);
  assert.equal(partiallyRefunded.stage, "converted");
  assert.equal(partiallyRefunded.temperature, "customer");

  const secondPurchase = event("purchase", "2025-01-01T01:04:00Z", { amountMinor: 5000, currency: "TWD" });
  const repurchased = scoreLeadInsight(registration, [purchase, fullRefund, secondPurchase]);
  assert.equal(repurchased.stage, "converted");
  assert.equal(repurchased.score, 100);
});

test("summary and response fields are stable", () => {
  const result = buildLeadInsights([registration], [], { videoDuration: 600 });
  assert.deepEqual(Object.keys(result), ["summary", "insights"]);
  assert.deepEqual(Object.keys(result.summary), ["total", "cold", "warm", "hot", "customers", "refunded"]);
  assert.deepEqual(Object.keys(result.insights[0]), ["registrationId", "score", "stage", "temperature", "lastActivityAt", "recommendation", "suppressSalesFollowUp", "evidenceCount", "evidence", "timeline"]);
});
test("attendance on the registration counts even without room events", () => {
  const attendee = {
    id: "reg-attended",
    registeredAt: new Date("2025-01-01T00:00:00Z"),
    attended: true,
    attendedAt: new Date("2025-01-01T01:00:00Z"),
    watchDuration: 1800,
  } as Registration;
  const insight = scoreLeadInsight(attendee, [], 3600);
  assert.equal(insight.stage, "engaged");
  // 10 registration + 10 entered + 50% watched x 0.2 = 30
  assert.equal(insight.score, 30);
  const absent = scoreLeadInsight({ id: "reg-absent", registeredAt: new Date("2025-01-01T00:00:00Z") } as Registration, [], 3600);
  assert.equal(absent.score, 10);
  assert.equal(absent.stage, "registered");
});
