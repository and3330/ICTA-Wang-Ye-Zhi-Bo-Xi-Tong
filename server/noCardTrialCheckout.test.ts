import assert from "node:assert/strict";
import test from "node:test";
import { immediatePaidSubscriptionData } from "./routes";

test("new subscription checkout options never create a Stripe trial", () => {
  const subscriptionData = immediatePaidSubscriptionData({
    userId: "user-1",
    planKey: "starter",
    billingInterval: "month",
    addonWebinars: 2,
  }) as Record<string, unknown>;
  assert.deepEqual(subscriptionData.metadata, {
    userId: "user-1",
    planKey: "starter",
    billingInterval: "month",
    addonWebinars: "2",
  });
  assert.equal("trial_period_days" in subscriptionData, false);
  assert.equal("trial_end" in subscriptionData, false);
});