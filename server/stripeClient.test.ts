import assert from "node:assert/strict";
import test from "node:test";
import { shouldUseLiveStripeCredentials } from "./stripeClient";

test("production and explicit live modes always use Stripe Live credentials", () => {
  assert.equal(shouldUseLiveStripeCredentials({ NODE_ENV: "production" }), true);
  assert.equal(shouldUseLiveStripeCredentials({ REPLIT_DEPLOYMENT: "1" }), true);
  assert.equal(shouldUseLiveStripeCredentials({ STRIPE_LIVE_MODE: "1" }), true);
  assert.equal(shouldUseLiveStripeCredentials({ NODE_ENV: "development" }), false);
});