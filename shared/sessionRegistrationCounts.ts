import { z } from "zod";

/**
 * Stable labels used by the owner dashboard.  `labelKind` deliberately
 * describes how a slot was identified rather than exposing database session
 * implementation details.
 */
export const sessionRegistrationCountLabelKinds = [
  "session",
  "recurring",
  "justInTime",
  "onDemand",
  "unassigned",
] as const;
export type SessionRegistrationCountLabelKind = typeof sessionRegistrationCountLabelKinds[number];

export const sessionRegistrationCountStatuses = [
  "scheduled",
  "live",
  "ended",
  "cancelled",
  "unknown",
] as const;
export type SessionRegistrationCountStatus = typeof sessionRegistrationCountStatuses[number];

export type SessionRegistrationCountRow = {
  /** Stable dashboard key. Timed slots use their canonical epoch milliseconds. */
  key: string;
  startTimeISO: string | null;
  labelKind: SessionRegistrationCountLabelKind;
  status: SessionRegistrationCountStatus;
  registrationCount: number;
};

export type SessionRegistrationCountsDto = {
  counts: SessionRegistrationCountRow[];
  totalRegistered: number;
};

export const sessionRegistrationCountRowSchema = z.object({
  key: z.string().min(1),
  startTimeISO: z.string().datetime({ offset: true }).nullable(),
  labelKind: z.enum(sessionRegistrationCountLabelKinds),
  status: z.enum(sessionRegistrationCountStatuses),
  registrationCount: z.number().int().nonnegative(),
});

export const sessionRegistrationCountsDtoSchema = z.object({
  counts: z.array(sessionRegistrationCountRowSchema),
  totalRegistered: z.number().int().nonnegative(),
});

/** PostgreSQL timestamps and JavaScript Dates are normalized to milliseconds. */
export function canonicalSessionTimeMs(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const milliseconds = value instanceof Date
    ? value.getTime()
    : new Date(value as string | number).getTime();
  if (!Number.isFinite(milliseconds)) return null;
  return Math.trunc(milliseconds);
}

export function sessionTimeISO(milliseconds: number): string {
  return new Date(milliseconds).toISOString();
}