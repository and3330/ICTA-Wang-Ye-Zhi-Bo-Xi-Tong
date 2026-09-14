import assert from "node:assert/strict";
import test from "node:test";
import {
  signupConversion,
  validatePlatformAiPointsCheckout,
  validatePlatformSubscriptionCheckout,
} from "./platformConversions";

function subscriptionSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "cs_subscription_123",
    mode: "subscription",
    status: "complete",
    payment_status: "paid",
    amount_total: 2900,
    currency: "usd",
    customer: "cus_member_1",
    metadata: {
      kind: "subscription",
      userId: "member_1",
      planKey: "starter",
      billingInterval: "month",
      addonWebinars: "0",
    },
    ...overrides,
  } as any;
}

test("signup conversion is opaque and distinct from login", () => {
  const conversion = signupConversion("platform_signup:event_1", "member_1");
  assert.deepEqual(conversion, {
    eventName: "CompleteRegistration",
    eventId: "platform_signup:event_1",
    accountMarker: "member_1",
  });
});

test("subscription conversion requires the owned approved line items", () => {
  const paid = validatePlatformSubscriptionCheckout({
    session: subscriptionSession(),
    lineItems: [{ price: "price_starter_month", quantity: 1 }],
    userId: "member_1",
    stripeCustomerId: "cus_member_1",
    planKey: "starter",
    billingInterval: "month",
    addonWebinars: 0,
    basePriceId: "price_starter_month",
  });
  assert.equal(paid.status, "paid");
  assert.equal(paid.conversion?.eventName, "Purchase");
  assert.equal(paid.conversion?.value, 29);
  assert.equal(paid.conversion?.currency, "USD");
  assert.equal(paid.conversion?.eventId, "platform_subscription:cs_subscription_123");

  assert.throws(() => validatePlatformSubscriptionCheckout({
    session: subscriptionSession(),
    lineItems: [{ price: "price_foreign", quantity: 1 }],
    userId: "member_1",
    stripeCustomerId: "cus_member_1",
    planKey: "starter",
    billingInterval: "month",
    addonWebinars: 0,
    basePriceId: "price_starter_month",
  }), /INVALID_PLATFORM_CHECKOUT/);
});

test("subscription conversion remains pending until Stripe reports paid", () => {
  const pending = validatePlatformSubscriptionCheckout({
    session: subscriptionSession({ payment_status: "unpaid" }),
    lineItems: [{ price: "price_starter_month", quantity: 1 }],
    userId: "member_1",
    stripeCustomerId: "cus_member_1",
    planKey: "starter",
    billingInterval: "month",
    addonWebinars: 0,
    basePriceId: "price_starter_month",
  });
  assert.deepEqual(pending, { status: "pending" });
});

test("foreign subscription and AI-point sessions cannot produce conversions", () => {
  assert.throws(() => validatePlatformSubscriptionCheckout({
    session: subscriptionSession({ customer: "cus_other" }),
    lineItems: [{ price: "price_starter_month", quantity: 1 }],
    userId: "member_1",
    stripeCustomerId: "cus_member_1",
    planKey: "starter",
    billingInterval: "month",
    addonWebinars: 0,
    basePriceId: "price_starter_month",
  }), /INVALID_PLATFORM_CHECKOUT/);

  const paidRecharge = validatePlatformAiPointsCheckout({
    session: {
      id: "cs_recharge_123",
      mode: "payment",
      status: "complete",
      payment_status: "paid",
      amount_total: 30000,
      currency: "twd",
      customer: "cus_member_1",
      metadata: { kind: "ai_points", userId: "member_1", points: "300", amountTwd: "300" },
    } as any,
    userId: "member_1",
    stripeCustomerId: "cus_member_1",
    points: 300,
    amountTwd: 300,
  });
  assert.equal(paidRecharge.status, "paid");
  assert.equal(paidRecharge.conversion?.value, 300);
  assert.equal(paidRecharge.conversion?.currency, "TWD");

  const unpaidRecharge = validatePlatformAiPointsCheckout({
    session: {
      id: "cs_recharge_123",
      mode: "payment",
      status: "open",
      payment_status: "unpaid",
      amount_total: 30000,
      currency: "twd",
      customer: "cus_member_1",
      metadata: { kind: "ai_points", userId: "member_1", points: "300", amountTwd: "300" },
    } as any,
    userId: "member_1",
    stripeCustomerId: "cus_member_1",
    points: 300,
    amountTwd: 300,
  });
  assert.deepEqual(unpaidRecharge, { status: "pending" });

  assert.throws(() => validatePlatformAiPointsCheckout({
    session: {
      id: "cs_recharge_123",
      mode: "payment",
      status: "complete",
      payment_status: "paid",
      amount_total: 30000,
      currency: "twd",
      customer: "cus_other",
      metadata: { kind: "ai_points", userId: "member_1", points: "300", amountTwd: "300" },
    } as any,
    userId: "member_1",
    stripeCustomerId: "cus_member_1",
    points: 300,
    amountTwd: 300,
  }), /INVALID_PLATFORM_CHECKOUT/);
});