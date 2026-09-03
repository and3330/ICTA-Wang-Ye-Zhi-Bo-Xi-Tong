import assert from "node:assert/strict";
import test from "node:test";
import { allocateAiCreditLots } from "./storage";
import { isPaidBillableSubscriptionInvoice, monthlyGiftForLookupKeys, oneYearAfter } from "./subscriptionCreditGrants";

test("subscription plans grant the configured monthly AI points", () => {
  assert.deepEqual(monthlyGiftForLookupKeys(["icta_webinar_starter_monthly"]), { planKey: "starter", points: 100 });
  assert.deepEqual(monthlyGiftForLookupKeys(["icta_webinar_growth_monthly"]), { planKey: "growth", points: 200 });
  assert.deepEqual(monthlyGiftForLookupKeys(["icta_webinar_scale_monthly"]), { planKey: "scale", points: 300 });
  assert.equal(monthlyGiftForLookupKeys(["icta_webinar_room_addon_monthly"]), null);
  // A delayed Starter invoice must still grant Starter points even if the
  // subscriber has since moved to another plan.
  assert.deepEqual(
    monthlyGiftForLookupKeys(["icta_webinar_starter_monthly", "icta_webinar_room_addon_monthly"]),
    { planKey: "starter", points: 100 },
  );
});

test("monthly gifted credits expire after one calendar year, including leap day", () => {
  assert.equal(
    oneYearAfter(new Date("2026-09-03T08:30:00.000Z")).toISOString(),
    "2027-09-03T08:30:00.000Z",
  );
  assert.equal(
    oneYearAfter(new Date("2024-02-29T08:30:00.000Z")).toISOString(),
    "2025-02-28T08:30:00.000Z",
  );
});

test("a zero-dollar trial invoice never grants monthly AI points", () => {
  assert.equal(isPaidBillableSubscriptionInvoice({
    status: "paid",
    amount_paid: 0,
    billing_reason: "subscription_create",
  }), false);
  assert.equal(isPaidBillableSubscriptionInvoice({
    status: "paid",
    amount_paid: 4900,
    billing_reason: "subscription_cycle",
  }), true);
});

test("AI credit allocation consumes lots in the order supplied and rejects partial reservations", () => {
  const lots = [
    { id: "gift-expiring-first", remainingPoints: 40 },
    { id: "gift-expiring-later", remainingPoints: 80 },
    { id: "permanent-purchase", remainingPoints: 500 },
  ];
  assert.deepEqual(allocateAiCreditLots(lots, 100), [
    { lotId: "gift-expiring-first", points: 40 },
    { lotId: "gift-expiring-later", points: 60 },
  ]);
  assert.equal(allocateAiCreditLots(lots, 621), null);
});