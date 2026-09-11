/**
 * Manual member-plan grants are internal, time-bounded entitlements. They do
 * not represent a Stripe subscription, trial, invoice, or AI-credit gift.
 */
export const memberManualPlanKeys = ["starter", "growth", "scale"] as const;
export type MemberManualPlanKey = typeof memberManualPlanKeys[number];

export type MemberManualPlanState = "pending" | "active" | "expired" | "revoked";

export type MemberManualPlanDto = {
  id: string;
  userId: string;
  plan: MemberManualPlanKey;
  state: MemberManualPlanState;
  startsAt: string;
  expiresAt: string;
  revokedAt: string | null;
  revokedBy: string | null;
  reason: string;
  version: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
};

export type EffectiveMemberPlanDto = {
  plan: string;
  source: "paid" | "manual" | "override" | "free" | "enterprise";
  active: boolean;
  maxWebinars: number;
  monthlyRegistrants: number | null;
  manualExpiresAt: string | null;
};

export type CreateMemberManualPlanBody = {
  plan: MemberManualPlanKey;
  startsAt: string;
  expiresAt: string;
  reason: string;
  idempotencyKey: string;
};

export type UpdateMemberManualPlanBody = {
  plan?: MemberManualPlanKey;
  startsAt?: string;
  expiresAt?: string;
  /** Adds this exact duration to the current expiry. */
  extendHours?: number;
  reason: string;
  version: number;
  idempotencyKey: string;
};

export type RevokeMemberManualPlanBody = {
  reason: string;
  version: number;
  idempotencyKey: string;
};