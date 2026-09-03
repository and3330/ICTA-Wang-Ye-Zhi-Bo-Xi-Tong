import assert from "node:assert/strict";
import test from "node:test";
import {
  computeSubscriptionEntitlement,
  type EntitlementSubscription,
  type SubscriptionPlanKey,
} from "./subscriptionEntitlements";

const NOW = new Date("2026-08-31T12:00:00.000Z");

function subscription(
  status: string,
  options: {
    cancelAtPeriodEnd?: boolean;
    periodEnd?: string;
  } = {},
): EntitlementSubscription {
  return {
    id: `sub_${status}`,
    status,
    created: Math.floor(new Date("2026-08-01T00:00:00.000Z").getTime() / 1000),
    cancel_at_period_end: options.cancelAtPeriodEnd ?? false,
    current_period_start: Math.floor(new Date("2026-08-01T00:00:00.000Z").getTime() / 1000),
    current_period_end: Math.floor(
      new Date(options.periodEnd ?? "2026-09-01T00:00:00.000Z").getTime() / 1000,
    ),
    items: { data: [] },
  };
}

function entitlement(
  status: string,
  plan: SubscriptionPlanKey = "starter",
  addonWebinars = 0,
  options: Parameters<typeof subscription>[1] = {},
) {
  return computeSubscriptionEntitlement(subscription(status, options), plan, addonWebinars, NOW);
}

test("active and trialing subscriptions receive their publishing quota", () => {
  assert.equal(entitlement("active").active, true);
  assert.equal(entitlement("active").maxWebinars, 1);
  assert.equal(entitlement("trialing", "growth").active, true);
  assert.equal(entitlement("trialing", "growth").maxWebinars, 5);
});

test("Starter, Growth, Scale, and add-on quantities map to the correct quota", () => {
  assert.equal(entitlement("active", "starter", 3).maxWebinars, 4);
  assert.equal(entitlement("active", "growth", 2).maxWebinars, 7);
  assert.equal(entitlement("active", "scale", 0).maxWebinars, 15);
});

test("Starter reports the actual subscribed price for new and grandfathered customers", () => {
  assert.equal(entitlement("active", "starter").amountUsd, 39);
  assert.equal(
    computeSubscriptionEntitlement(subscription("active"), "starter", 0, NOW, 49).amountUsd,
    49,
  );
});

test("past_due, canceled, and expired subscriptions cannot add publications", () => {
  for (const status of ["past_due", "canceled", "expired"]) {
    const result = entitlement(status, "growth", 2);
    assert.equal(result.active, false, status);
    assert.equal(result.maxWebinars, 0, status);
    assert.equal(result.plan, "growth", status);
  }
});

test("period-end cancellation remains usable before expiry", () => {
  const result = entitlement("active", "starter", 1, {
    cancelAtPeriodEnd: true,
    periodEnd: "2026-09-01T00:00:00.000Z",
  });
  assert.equal(result.active, true);
  assert.equal(result.maxWebinars, 2);
  assert.equal(result.cancelAtPeriodEnd, true);
});

test("an active-looking subscription is blocked after its period expires", () => {
  const result = entitlement("active", "growth", 2, {
    cancelAtPeriodEnd: true,
    periodEnd: "2026-08-31T11:59:59.000Z",
  });
  assert.equal(result.active, false);
  assert.equal(result.maxWebinars, 0);
  assert.equal(result.plan, "growth");
  assert.equal(result.cancelAtPeriodEnd, true);
});