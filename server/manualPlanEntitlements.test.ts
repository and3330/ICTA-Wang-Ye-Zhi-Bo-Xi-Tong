import assert from "node:assert/strict";
import test from "node:test";
import type { SubscriptionEntitlement } from "./subscriptionEntitlements";
import { composePublishingOverride, effectiveMemberPlan, effectiveMonthlyRegistrantLimit, manualPlanState } from "./manualPlanEntitlements";

const now = new Date("2026-09-01T12:00:00.000Z");
const paidFree: SubscriptionEntitlement = {
  plan: "free", status: "inactive", active: false, amountUsd: null, maxWebinars: 0,
  addonWebinars: 0, startedAt: null, currentPeriodEnd: null, cancelAtPeriodEnd: false,
  stripeSubscriptionId: null,
};

function manual(overrides: Record<string, unknown> = {}) {
  return {
    id: "manual-1", userId: "member-1", publishingSlots: 5, manualPlan: "growth",
    startsAt: new Date("2026-09-01T11:00:00.000Z"), expiresAt: new Date("2026-09-02T12:00:00.000Z"),
    reason: "support accommodation", createdBy: "root-1", createdAt: now, version: 1,
    revokedAt: null, revokedBy: null, updatedAt: now, ...overrides,
  } as any;
}

test("manual plans are active only inside their exact time window and stop on revoke", () => {
  assert.equal(manualPlanState(manual(), now), "active");
  assert.equal(manualPlanState(manual({ startsAt: new Date("2026-09-01T12:00:00.001Z") }), now), "pending");
  assert.equal(manualPlanState(manual({ expiresAt: new Date("2026-09-01T11:59:59.999Z") }), now), "expired");
  assert.equal(manualPlanState(manual({ revokedAt: now }), now), "revoked");
});

test("an active manual plan gives a free member non-AI plan capacity", () => {
  const effective = effectiveMemberPlan(paidFree, manual(), now);
  assert.deepEqual(effective, {
    plan: "growth", source: "manual", active: true, maxWebinars: 5,
    monthlyRegistrants: 3_000, manualExpiresAt: "2026-09-02T12:00:00.000Z",
  });
});

test("future, expired, and revoked manual plans cannot activate a free member", () => {
  for (const row of [
    manual({ startsAt: new Date("2026-09-01T12:00:00.001Z") }),
    manual({ expiresAt: new Date("2026-09-01T11:59:59.999Z") }),
    manual({ revokedAt: now }),
  ]) {
    const effective = effectiveMemberPlan(paidFree, row, now);
    assert.equal(effective.active, false);
    assert.equal(effective.plan, "free");
    assert.equal(effective.maxWebinars, 0);
  }
});

test("manual capacity is composed with paid capacity and never reduces paid rights", () => {
  const paidGrowth: SubscriptionEntitlement = { ...paidFree, plan: "growth", status: "active", active: true, maxWebinars: 7 };
  const lowerManual = effectiveMemberPlan(paidGrowth, manual({ manualPlan: "starter" }), now);
  assert.equal(lowerManual.source, "paid");
  assert.equal(lowerManual.maxWebinars, 7);
  assert.equal(lowerManual.monthlyRegistrants, 3_000);

  const higherManual = effectiveMemberPlan(paidGrowth, manual({ manualPlan: "scale" }), now);
  assert.equal(higherManual.source, "manual");
  assert.equal(higherManual.maxWebinars, 15);
  assert.equal(higherManual.monthlyRegistrants, 5_000);
  assert.equal(paidGrowth.status, "active");
});

test("manual registration quota applies to a free member and uses the maximum paid quota", () => {
  assert.equal(effectiveMonthlyRegistrantLimit("free", false, manual(), now), 3_000);
  assert.equal(effectiveMonthlyRegistrantLimit("free", false, manual({ expiresAt: new Date("2026-09-01T11:59:59.999Z") }), now), null);
  assert.equal(effectiveMonthlyRegistrantLimit("growth", true, manual({ manualPlan: "scale" }), now), 5_000);
  assert.equal(effectiveMonthlyRegistrantLimit("growth", true, manual({ manualPlan: "starter" }), now), 3_000);
});

test("the active publishing override is additive to paid or manual effective capacity", () => {
  const paidGrowth: SubscriptionEntitlement = { ...paidFree, plan: "growth", status: "active", active: true, maxWebinars: 5 };
  const composed = composePublishingOverride(effectiveMemberPlan(paidGrowth, manual({ manualPlan: "starter" }), now), { publishingSlots: 100 });
  assert.equal(composed.active, true);
  assert.equal(composed.source, "override");
  assert.equal(composed.maxWebinars, 100);
});