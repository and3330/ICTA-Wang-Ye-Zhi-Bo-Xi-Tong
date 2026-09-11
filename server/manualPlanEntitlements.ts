import { and, desc, eq, gt, isNotNull, lte } from "drizzle-orm";
import { entitlementOverrides } from "@shared/schema";
import type { EffectiveMemberPlanDto, MemberManualPlanDto, MemberManualPlanKey, MemberManualPlanState } from "@shared/memberManualPlans";
import type { SubscriptionEntitlement } from "./subscriptionEntitlements";
import { SUBSCRIPTION_PLANS, getMonthlyRegistrantLimit } from "./subscriptionEntitlements";
import { db } from "./db";

type ManualPlanRow = typeof entitlementOverrides.$inferSelect;

export function manualPlanState(row: Pick<ManualPlanRow, "startsAt" | "expiresAt" | "revokedAt">, now = new Date()): MemberManualPlanState {
  if (row.revokedAt) return "revoked";
  if (row.expiresAt.getTime() <= now.getTime()) return "expired";
  if (row.startsAt.getTime() > now.getTime()) return "pending";
  return "active";
}

export function manualPlanDto(row: ManualPlanRow, now = new Date()): MemberManualPlanDto {
  return {
    id: row.id, userId: row.userId, plan: row.manualPlan as MemberManualPlanKey,
    state: manualPlanState(row, now), startsAt: row.startsAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(), revokedAt: row.revokedAt?.toISOString() || null,
    revokedBy: row.revokedBy || null, reason: row.reason, version: row.version,
    createdAt: row.createdAt.toISOString(), createdBy: row.createdBy,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Returns the one retained grant even when it is pending, expired, or revoked. */
export async function memberManualPlan(userId: string): Promise<ManualPlanRow | undefined> {
  const [row] = await db.select().from(entitlementOverrides).where(and(
    eq(entitlementOverrides.userId, userId), isNotNull(entitlementOverrides.manualPlan),
  )).limit(1);
  return row;
}

/** Checked at every public admission; no cached user field can outlive expiry. */
export async function activeMemberManualPlan(userId: string, now = new Date()): Promise<ManualPlanRow | undefined> {
  const [row] = await db.select().from(entitlementOverrides).where(and(
    eq(entitlementOverrides.userId, userId), isNotNull(entitlementOverrides.manualPlan),
    lte(entitlementOverrides.startsAt, now), gt(entitlementOverrides.expiresAt, now),
  )).orderBy(desc(entitlementOverrides.expiresAt)).limit(1);
  return row?.revokedAt ? undefined : row;
}

export function effectiveMemberPlan(
  paid: SubscriptionEntitlement,
  manual: ManualPlanRow | undefined,
  now = new Date(),
): EffectiveMemberPlanDto {
  const activeManual = manual && manualPlanState(manual, now) === "active" ? manual : undefined;
  const manualCapacity = activeManual ? SUBSCRIPTION_PLANS[activeManual.manualPlan as MemberManualPlanKey] : undefined;
  const paidRegistrantLimit = paid.active ? getMonthlyRegistrantLimit(paid.plan) : null;
  const paidUnlimited = paid.active && (paid.plan === "enterprise" || paid.plan === "legacy");
  const manualWins = Boolean(manualCapacity && (!paid.active || manualCapacity.baseWebinars > paid.maxWebinars));
  const active = paid.active || Boolean(manualCapacity);
  const plan = manualWins ? activeManual!.manualPlan! : paid.active ? paid.plan : "free";
  const source: EffectiveMemberPlanDto["source"] = paid.plan === "enterprise" && paid.active
    ? "enterprise" : manualWins ? "manual" : paid.active ? "paid" : "free";
  return {
    plan, source, active,
    maxWebinars: paidUnlimited ? paid.maxWebinars : Math.max(paid.active ? paid.maxWebinars : 0, manualCapacity?.baseWebinars || 0),
    monthlyRegistrants: paidUnlimited ? null : Math.max(paidRegistrantLimit || 0, manualCapacity?.monthlyRegistrants || 0) || null,
    manualExpiresAt: activeManual?.expiresAt.toISOString() || null,
  };
}

/** Applies a legacy publishing-only override without implying paid billing. */
export function composePublishingOverride(
  effective: EffectiveMemberPlanDto,
  override: Pick<ManualPlanRow, "publishingSlots"> | undefined,
): EffectiveMemberPlanDto {
  if (!override) return effective;
  const overrideWins = override.publishingSlots > effective.maxWebinars;
  return {
    ...effective,
    active: true,
    maxWebinars: Math.max(effective.maxWebinars, override.publishingSlots),
    source: overrideWins ? "override" : effective.source,
  };
}

export function effectiveMonthlyRegistrantLimit(paidPlan: string, hasActivePaidPlan: boolean, manual: ManualPlanRow | undefined, now = new Date()): number | null {
  if (hasActivePaidPlan && (paidPlan === "enterprise" || paidPlan === "legacy")) return null;
  const paidLimit = hasActivePaidPlan ? getMonthlyRegistrantLimit(paidPlan) || 0 : 0;
  const activeManual = manual && manualPlanState(manual, now) === "active" ? manual : undefined;
  const manualLimit = activeManual ? SUBSCRIPTION_PLANS[activeManual.manualPlan as MemberManualPlanKey].monthlyRegistrants : 0;
  return Math.max(paidLimit, manualLimit) || null;
}