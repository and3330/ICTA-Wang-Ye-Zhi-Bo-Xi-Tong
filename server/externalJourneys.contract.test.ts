import test from "node:test";
import assert from "node:assert/strict";
import {
  externalBrowserReportSchema, externalJourneySettingsSchema, externalMerchantEventSchema,
  externalOrderDtoSchema, externalReferralRequestSchema,
} from "@shared/externalJourneys";

test("external journey contract materializes safe disabled handoff defaults", () => {
  const parsed = externalJourneySettingsSchema.parse({
    landingMode: "builtin", thankYouMode: "builtin", approvedOrigins: [], approvedEmbedOrigins: [],
  });
  assert.equal(parsed.secureHandoffEnabled, false);
  assert.equal(parsed.includeWatchLinkInHandoff, false);
  assert.equal(parsed.includeContactInHandoff, false);
});

test("external contracts reject PII and unscoped referral identities", () => {
  assert.equal(externalBrowserReportSchema.safeParse({
    scRef: "a".repeat(43), orderId: "order-1", amountMinor: 100, currency: "usd", email: "no@example.test",
  }).success, false);
  assert.equal(externalReferralRequestSchema.safeParse({
    targetKind: "cta", targetUrl: "https://example.com/pay",
  }).success, false);
  assert.equal(externalReferralRequestSchema.safeParse({
    targetKind: "thank_you", targetUrl: "https://example.com/thanks", ctaId: "00000000-0000-4000-8000-000000000000",
  }).success, false);
});

test("merchant refund contract uses an explicit cumulative integer amount", () => {
  const event = externalMerchantEventSchema.parse({
    eventId: "refund-2", orderId: "order-1", type: "refund", amountMinor: 1_000, currency: "twd",
  });
  assert.equal(event.amountMinor, 1_000);
  assert.equal(event.currency, "TWD");
});

test("refund-first external order DTO explicitly has unknown paid/net totals", () => {
  assert.equal(externalOrderDtoSchema.safeParse({
    id: "00000000-0000-4000-8000-000000000000", orderId: "o", webinarId: "00000000-0000-4000-8000-000000000001",
    sessionId: null, selectedSession: null, sourceTrust: "merchant_reported", currency: "USD",
    purchaseObserved: false, grossPaidMinor: null, refundedMinor: 100, netMinor: null,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  }).success, true);
});