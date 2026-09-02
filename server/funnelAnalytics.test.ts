import assert from "node:assert/strict";
import test from "node:test";
import type { WebinarFunnelEvent } from "@shared/schema";
import { aggregateFunnelEvents, authoritativeRegistrationFunnelEvent, funnelDedupeKey, funnelEventInputSchema, safeRequestMetadata, sha256 } from "./funnelAnalytics";

test("funnel event validation enforces event-specific fields and rejects arbitrary metadata", () => {
  const base = { visitorToken: "visitor-token-long-enough", dedupeKey: "event-key-123" };
  assert.equal(funnelEventInputSchema.safeParse({ ...base, eventType: "dropoff" }).success, false);
  assert.equal(funnelEventInputSchema.safeParse({ ...base, eventType: "cta_click" }).success, false);
  assert.equal(funnelEventInputSchema.safeParse({ ...base, eventType: "purchase", value: 10 }).success, false);
  assert.equal(funnelEventInputSchema.safeParse({
    ...base,
    eventType: "landing_view",
    metadata: { email: "must-not-be-stored@example.com" },
  }).success, false);
  assert.equal(funnelEventInputSchema.safeParse({
    ...base,
    eventType: "purchase",
    value: 10,
    currency: "twd",
  }).success, true);
  assert.equal(funnelEventInputSchema.safeParse({
    ...base,
    eventType: "cta_click",
    ctaId: "9c15edb6-af0d-481e-8806-d686ad204517",
    ctaKey: "<unsafe>",
  }).success, false);
});

test("safe server context stores hostname and hashes network identity", () => {
  const metadata = safeRequestMetadata(
    { source: "newsletter" },
    { referrer: "https://example.com/private/path?q=secret", ip: "203.0.113.1", userAgent: "agent", hashSalt: "test" },
  );
  assert.equal(metadata.referrerHost, "example.com");
  assert.equal(metadata.ipHash?.length, 64);
  assert.equal(JSON.stringify(metadata).includes("private"), false);
  assert.equal(JSON.stringify(metadata).includes("203.0.113.1"), false);
});

test("funnel dedupe keys are deterministic and scoped by event type", () => {
  assert.equal(funnelDedupeKey("cta_click", "same-client-key"), funnelDedupeKey("cta_click", "same-client-key"));
  assert.notEqual(funnelDedupeKey("cta_click", "same-client-key"), funnelDedupeKey("cta_view", "same-client-key"));
  assert.equal(
    funnelDedupeKey("registration", "client-retry-one", "9c15edb6-af0d-481e-8806-d686ad204517"),
    funnelDedupeKey("registration", "client-retry-two", "9c15edb6-af0d-481e-8806-d686ad204517"),
  );
});

test("authoritative registration event hashes the optional analytics token and joins landing identity", () => {
  const token = "same-anonymous-token-123";
  const registration = authoritativeRegistrationFunnelEvent("webinar-1", "registration-1", token);
  assert.equal(registration.visitorTokenHash, sha256(token));
  assert.equal("analyticsVisitorToken" in registration, false);
  const result = aggregateFunnelEvents([
    eventForIdentity("landing", "landing_view", sha256(token)),
    { id: "registration", sessionId: null, ctaId: null, ctaKey: null, positionSeconds: null, value: null, currency: null, occurredAt: new Date(), ...registration },
  ] as WebinarFunnelEvent[], 0);
  assert.equal(result.uniqueViewers, 1);
  assert.equal(result.uniqueByStage.registration, 1);
});

function eventForIdentity(id: string, eventType: WebinarFunnelEvent["eventType"], visitorTokenHash: string): WebinarFunnelEvent {
  return {
    id, webinarId: "webinar-1", eventType, registrationId: null, sessionId: null, ctaId: null, ctaKey: null,
    visitorTokenHash, positionSeconds: null, value: null, currency: null, dedupeKey: id, metadata: {}, occurredAt: new Date(),
  };
}

test("funnel aggregation deduplicates viewers and computes CTA/dropoff metrics", () => {
  const event = (
    id: string,
    eventType: WebinarFunnelEvent["eventType"],
    visitorTokenHash: string,
    extra: Partial<WebinarFunnelEvent> = {},
  ): WebinarFunnelEvent => ({
    id,
    webinarId: "webinar",
    eventType,
    registrationId: null,
    sessionId: null,
    ctaId: null,
    ctaKey: null,
    visitorTokenHash,
    positionSeconds: null,
    value: null,
    currency: null,
    dedupeKey: id,
    metadata: {},
    occurredAt: new Date(),
    ...extra,
  });
  const result = aggregateFunnelEvents([
    event("1", "landing_view", "viewer-a"),
    event("2", "landing_view", "viewer-a"),
    event("3", "registration", "viewer-a"),
    event("4", "cta_view", "viewer-a", { ctaId: "cta-1", ctaKey: "cta_live_a" }),
    event("5", "cta_click", "viewer-a", { ctaId: "cta-1", ctaKey: "cta_live_a" }),
    event("6", "dropoff", "viewer-a", { positionSeconds: 55 }),
    event("7", "purchase", "viewer-a", { value: "125.50", currency: "TWD" }),
  ], 100);

  assert.equal(result.counts.landing_view, 2);
  assert.equal(result.uniqueViewers, 1);
  assert.equal(result.uniqueByStage.landing_view, 1);
  assert.equal(result.ctaPerformance[0].clickThroughRate, 100);
  assert.equal(result.ctaPerformance[0].ctaKey, "cta_live_a");
  assert.equal(result.dropoffBuckets[2].count, 1);
  assert.equal(result.revenue.TWD, 125.5);
});