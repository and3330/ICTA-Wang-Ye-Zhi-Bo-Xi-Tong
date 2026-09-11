import { and, eq, inArray, sql } from "drizzle-orm";
import {
  entitlementOverrides,
  noCardTrialAiCalls,
  noCardTrials,
  type NoCardTrial,
  users,
  type User,
} from "@shared/schema";
import {
  NO_CARD_TRIAL_AI_CALL_LIMIT,
  NO_CARD_TRIAL_DAYS,
  NO_CARD_TRIAL_MILESTONES,
  NO_CARD_TRIAL_RETENTION_DAYS,
  type NoCardTrialStatus,
} from "@shared/noCardTrial";
import { db } from "./db";
import crypto from "node:crypto";

export type TrialAiReservation = {
  reservationId: string;
  reservationIds: string[];
  remaining: number;
};

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function isNeverTrialEligible(user: User, hasManualEntitlement: boolean): boolean {
  // A Stripe customer is historical billing evidence even when its most recent
  // subscription is canceled. Do not offer a second trial after any billing.
  return !user.stripeTrialClaimedAt
    && !user.stripeCustomerId
    && !user.stripeSubscriptionId
    && !user.subscriptionStartedAt
    && !user.planExpiresAt
    && user.subscriptionPlan === "free"
    && user.subscriptionStatus === "inactive"
    && !hasManualEntitlement;
}

async function hasManualEntitlement(tx: any, userId: string): Promise<boolean> {
  const row = await tx.select({ userId: entitlementOverrides.userId })
    .from(entitlementOverrides)
    .where(and(
      eq(entitlementOverrides.userId, userId),
      sql`${entitlementOverrides.manualPlan} IS NOT NULL`,
    ))
    .limit(1);
  return Boolean(row[0]);
}

async function hasActiveStrongerEntitlement(tx: any, userId: string, now: Date): Promise<boolean> {
  const [user] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
  const paid = Boolean(user && (
    user.isSuperAdmin ||
    user.subscriptionPlan === "enterprise" ||
    (["active", "trialing"].includes(user.subscriptionStatus)
      && (!user.planExpiresAt || user.planExpiresAt.getTime() > now.getTime()))
  ));
  if (paid) return true;
  const [manual] = await tx.select({ userId: entitlementOverrides.userId })
    .from(entitlementOverrides)
    .where(and(
      eq(entitlementOverrides.userId, userId),
      sql`${entitlementOverrides.manualPlan} IS NOT NULL`,
      sql`${entitlementOverrides.revokedAt} IS NULL`,
      sql`${entitlementOverrides.startsAt} <= ${now}`,
      sql`${entitlementOverrides.expiresAt} > ${now}`,
    ))
    .limit(1);
  return Boolean(manual);
}

async function trialUsage(tx: any, userId: string): Promise<number> {
  const [row] = await tx.select({
    used: sql<number>`count(*)::int`,
  }).from(noCardTrialAiCalls).where(and(
    eq(noCardTrialAiCalls.userId, userId),
    inArray(noCardTrialAiCalls.status, ["reserved", "completed"]),
  ));
  return Number(row?.used || 0);
}

export async function getNoCardTrial(userId: string): Promise<NoCardTrial | null> {
  const [trial] = await db.select().from(noCardTrials)
    .where(eq(noCardTrials.userId, userId))
    .limit(1);
  return trial || null;
}

/** Retained no-card history remains restricted until a real paid/manual right wins. */
export async function isNoCardTrialOnlyAccount(userId: string, now = new Date()): Promise<boolean> {
  return Boolean(await getNoCardTrial(userId)) && !await hasActiveStrongerEntitlement(db, userId, now);
}

export async function getNoCardTrialEligibility(userId: string): Promise<"eligible" | "ineligible"> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user || await hasManualEntitlement(db, userId)) return "ineligible";
  if (await getNoCardTrial(userId)) return "ineligible";
  return isNeverTrialEligible(user, false) ? "eligible" : "ineligible";
}

/**
 * Starts the one-ever 14-day no-card trial. It is lock-protected so concurrent
 * sign-up/activate requests cannot create or reset an entitlement.
 */
export async function ensureNoCardTrial(userId: string): Promise<NoCardTrial | null> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`no-card-trial:${userId}`}))`);
    const [existing] = await tx.select().from(noCardTrials)
      .where(eq(noCardTrials.userId, userId))
      .for("update");
    if (existing) return existing;

    const [user] = await tx.select().from(users).where(eq(users.id, userId)).for("update");
    if (!user || !isNeverTrialEligible(user, await hasManualEntitlement(tx, userId))) return null;

    const startsAt = new Date();
    const expiresAt = addDays(startsAt, NO_CARD_TRIAL_DAYS);
    const retentionUntil = addDays(expiresAt, NO_CARD_TRIAL_RETENTION_DAYS);
    const [trial] = await tx.insert(noCardTrials).values({
      userId,
      startsAt,
      expiresAt,
      retentionUntil,
    }).returning();
    return trial;
  });
}

/** Returns an entitlement only while it is live; expiry is never client-led. */
export async function getActiveNoCardTrial(userId: string, now = new Date()): Promise<NoCardTrial | null> {
  const trial = await getNoCardTrial(userId);
  if (await hasActiveStrongerEntitlement(db, userId, now)) return null;
  return trial && trial.startsAt.getTime() <= now.getTime() && trial.expiresAt.getTime() > now.getTime()
    ? trial
    : null;
}

/**
 * Reserves one ledger row for each upcoming provider request. It never touches
 * paid credit lots or users.ai_points. Reserving the complete batch prevents a
 * multi-request operation from making a partial provider call at the cap.
 */
export async function reserveTrialAiCall(userId: string, calls = 1): Promise<TrialAiReservation | null> {
  if (!Number.isInteger(calls) || calls < 1 || calls > NO_CARD_TRIAL_AI_CALL_LIMIT) {
    throw new Error("Invalid no-card trial AI reservation");
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`no-card-trial-ai:${userId}`}))`);
    const now = new Date();
    const [trial] = await tx.select().from(noCardTrials)
      .where(eq(noCardTrials.userId, userId))
      .for("update");
    if (!trial || trial.startsAt.getTime() > now.getTime() || trial.expiresAt.getTime() <= now.getTime()) return null;
    if (await hasActiveStrongerEntitlement(tx, userId, now)) return null;
    const used = await trialUsage(tx, userId);
    if (used + calls > NO_CARD_TRIAL_AI_CALL_LIMIT) return null;

    const reservationIds = Array.from({ length: calls }, () => crypto.randomUUID());
    await tx.insert(noCardTrialAiCalls).values(reservationIds.map((id) => ({
      id,
      userId,
      status: "reserved" as const,
      expiresAt: trial.expiresAt,
    })));
    return {
      reservationId: reservationIds[0],
      reservationIds,
      remaining: NO_CARD_TRIAL_AI_CALL_LIMIT - used - calls,
    };
  });
}

export async function refundTrialAiCall(reservationId: string): Promise<boolean> {
  const updated = await db.update(noCardTrialAiCalls)
    .set({ status: "refunded", completedAt: new Date() })
    .where(and(
      eq(noCardTrialAiCalls.id, reservationId),
      eq(noCardTrialAiCalls.status, "reserved"),
    ))
    .returning({ id: noCardTrialAiCalls.id });
  return updated.length === 1;
}

export async function completeTrialAiCall(reservationId: string): Promise<boolean> {
  const updated = await db.update(noCardTrialAiCalls)
    .set({ status: "completed", completedAt: new Date() })
    .where(and(
      eq(noCardTrialAiCalls.id, reservationId),
      eq(noCardTrialAiCalls.status, "reserved"),
    ))
    .returning({ id: noCardTrialAiCalls.id });
  return updated.length === 1;
}

export async function getNoCardTrialStatus(userId: string, now = new Date()): Promise<NoCardTrialStatus> {
  const trial = await getNoCardTrial(userId);
  if (!trial) {
    const eligibility = await getNoCardTrialEligibility(userId);
    return {
      eligibility,
      state: eligibility,
      startsAt: null,
      expiresAt: null,
      retentionUntil: null,
      remaining: NO_CARD_TRIAL_AI_CALL_LIMIT,
      remainingAI: NO_CARD_TRIAL_AI_CALL_LIMIT,
      usedAI: 0,
      milestones: NO_CARD_TRIAL_MILESTONES.map((day) => ({ day, reached: false })),
    };
  }
  const usedAI = await db.transaction((tx) => trialUsage(tx, userId));
  const active = trial.startsAt.getTime() <= now.getTime() && trial.expiresAt.getTime() > now.getTime();
  const upgraded = active && await hasActiveStrongerEntitlement(db, userId, now);
  return {
    eligibility: "ineligible",
    state: upgraded ? "upgraded" : active ? "active" : "expired",
    startsAt: trial.startsAt,
    expiresAt: trial.expiresAt,
    retentionUntil: trial.retentionUntil,
    remaining: Math.max(0, NO_CARD_TRIAL_AI_CALL_LIMIT - usedAI),
    remainingAI: Math.max(0, NO_CARD_TRIAL_AI_CALL_LIMIT - usedAI),
    usedAI,
    milestones: NO_CARD_TRIAL_MILESTONES.map((day) => ({
      day,
      // Day 1 begins at activation. Day N begins N-1 complete days later.
      reached: now.getTime() >= addDays(trial.startsAt, day - 1).getTime(),
    })),
  };
}

// Explicit aliases keep the trial billing API readable at call sites.
export const reserveNoCardTrialAiCall = reserveTrialAiCall;
export const refundNoCardTrialAiCall = refundTrialAiCall;
export const completeNoCardTrialAiCall = completeTrialAiCall;