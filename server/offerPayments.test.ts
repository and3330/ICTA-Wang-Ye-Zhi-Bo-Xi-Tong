import assert from "node:assert/strict";
import test from "node:test";
import { WebhookHandlers } from "./webhookHandlers";
import { createWebinarOfferSchema, insertCtaButtonSchema } from "@shared/schema";
import { assertOfferAttribution, calculateRefundDelta, providerEventDedupeKey, reconcileRefundCumulatives } from "./offerPayments";

test("a webhook signature failure cannot reach offer payment processing", async () => {
  let applied = false;
  await assert.rejects(() => WebhookHandlers.processWebhook(
    Buffer.from(JSON.stringify({ id: "evt_forged", type: "checkout.session.completed", data: { object: {} } })),
    "forged",
    {
      verifyAndSync: async () => { throw new Error("Invalid signature"); },
      applyVerifiedEvent: async () => {
        applied = true;
        return { duplicate: false };
      },
    },
  ), /Invalid signature/);
  assert.equal(applied, false);
});

test("only a verified payload is handed to domain payment processing", async () => {
  let receivedId = "";
  await WebhookHandlers.processWebhook(
    Buffer.from(JSON.stringify({ id: "evt_verified", type: "checkout.session.completed", data: { object: {} } })),
    "valid",
    {
      verifyAndSync: async () => {},
      applyVerifiedEvent: async (event) => {
        receivedId = event.id;
        return { duplicate: false };
      },
    },
  );
  assert.equal(receivedId, "evt_verified");
});

test("offer and CTA schemas reject invalid amounts, currencies, and missing destinations", () => {
  assert.equal(createWebinarOfferSchema.safeParse({ name: "Course", amountMinor: 1000, currency: "usd" }).success, true);
  assert.equal(createWebinarOfferSchema.safeParse({ name: "Course", amountMinor: 10.5, currency: "USD" }).success, false);
  assert.equal(createWebinarOfferSchema.safeParse({ name: "Course", amountMinor: 1000, currency: "US" }).success, false);
  const base = { webinarId: "webinar", text: "Buy", startTime: 0 };
  assert.equal(insertCtaButtonSchema.safeParse(base).success, false);
  assert.equal(insertCtaButtonSchema.safeParse({ ...base, url: "https://example.test" }).success, true);
  assert.equal(insertCtaButtonSchema.safeParse({ ...base, offerId: "9c15edb6-af0d-481e-8806-d686ad204517" }).success, true);
});

test("provider event replay keys are stable and refund transitions are exactly-once", () => {
  assert.equal(providerEventDedupeKey("evt_1"), providerEventDedupeKey("evt_1"));
  assert.notEqual(providerEventDedupeKey("evt_1"), providerEventDedupeKey("evt_2"));
  assert.equal(calculateRefundDelta(10_000, 0, 2_500), 2_500);
  assert.equal(calculateRefundDelta(10_000, 2_500, 2_500), 0);
  assert.equal(calculateRefundDelta(10_000, 2_500, 12_000), 7_500);

  let refunded = 0;
  const apply = (cumulative: number[]) => {
    const transition = reconcileRefundCumulatives(10_000, refunded, cumulative);
    refunded = transition.refundedMinor;
    return transition.refundDelta;
  };
  assert.equal(apply([2_500]), 2_500);
  assert.equal(apply([2_500]), 0, "a replay cannot create another refund event");
  assert.equal(apply([5_000]), 2_500);
  assert.equal(refunded, 5_000);
});

test("pending and concurrent refund cumulatives reconcile once when payment arrives", () => {
  // The pending rows collected before Checkout completion are reconciled under
  // the payment row lock, so an out-of-order full refund produces one delta.
  const latePayment = reconcileRefundCumulatives(10_000, 0, [2_500, 10_000]);
  assert.deepEqual(latePayment, { refundedMinor: 10_000, refundDelta: 10_000, status: "refunded" });
  // Multiple independently delivered cumulative refund events while locked
  // collapse to their maximum, rather than summing and overstating revenue.
  const concurrent = reconcileRefundCumulatives(10_000, 2_500, [5_000, 10_000, 5_000]);
  assert.deepEqual(concurrent, { refundedMinor: 10_000, refundDelta: 7_500, status: "refunded" });
  const replayAfterReconciliation = reconcileRefundCumulatives(10_000, 10_000, [10_000]);
  assert.equal(replayAfterReconciliation.refundDelta, 0);
});

test("offer attribution rejects cross-webinar CTA and registration identities", () => {
  const valid = {
    webinarId: "webinar-a",
    offerId: "offer-a",
    stripePriceId: "price_a",
    offer: { webinarId: "webinar-a", stripePriceId: "price_a" },
    cta: { webinarId: "webinar-a", offerId: "offer-a" },
  };
  assert.doesNotThrow(() => assertOfferAttribution(valid));
  assert.throws(() => assertOfferAttribution({
    ...valid,
    cta: { webinarId: "webinar-b", offerId: "offer-a" },
  }), /Cross-webinar/);
  assert.throws(() => assertOfferAttribution({
    ...valid,
    registrationWebinarId: "webinar-b",
  }), /Cross-webinar/);
});