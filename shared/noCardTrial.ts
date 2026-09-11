import { z } from "zod";

/** A no-card trial is a product entitlement, not a Stripe subscription. */
export const NO_CARD_TRIAL_DAYS = 14;
export const NO_CARD_TRIAL_AI_CALL_LIMIT = 50;
export const NO_CARD_TRIAL_RETENTION_DAYS = 30;
export const NO_CARD_TRIAL_MILESTONES = [1, 2, 3, 7, 12, 14] as const;

export const noCardTrialStateSchema = z.enum(["eligible", "active", "expired", "upgraded", "ineligible"]);
export type NoCardTrialState = z.infer<typeof noCardTrialStateSchema>;

export const noCardTrialCallStatusSchema = z.enum(["reserved", "completed", "refunded"]);
export type NoCardTrialCallStatus = z.infer<typeof noCardTrialCallStatusSchema>;

export type NoCardTrialStatus = {
  eligibility: NoCardTrialState;
  state: NoCardTrialState;
  startsAt: Date | null;
  expiresAt: Date | null;
  retentionUntil: Date | null;
  remaining: number;
  remainingAI: number;
  usedAI: number;
  milestones: Array<{ day: number; reached: boolean }>;
};