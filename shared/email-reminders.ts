import type { Registration, Webinar } from "./schema";

export const START_REMINDERS = [
  { kind: "reminder_5m", setting: "reminder5mEnabled", minutesBefore: 5 },
  { kind: "reminder_start", setting: "reminderStartEnabled", minutesBefore: 0 },
  { kind: "reminder_no_show_10m", setting: "reminderNoShow10mEnabled", minutesBefore: -10 },
] as const;

export function startReminderEnabled(
  settings: { reminder1hEnabled?: boolean; reminder5mEnabled?: boolean; reminderStartEnabled?: boolean; reminderNoShow10mEnabled?: boolean } | null | undefined,
  setting: "reminder5mEnabled" | "reminderStartEnabled" | "reminderNoShow10mEnabled",
) {
  // Preserve the existing timed-reminder opt-out on older webinars.
  return settings?.[setting] ?? settings?.reminder1hEnabled ?? true;
}

export function hasAttendance(registration: Pick<Registration, "attended" | "attendedAt" | "watchDuration">) {
  return registration.attended === true || !!registration.attendedAt || (registration.watchDuration ?? 0) > 0;
}

export function canSendNoShowReminder(registration: Registration, webinar: Pick<Webinar, "videoDuration">, now: Date) {
  if (registration.deletedAt || !registration.selectedSession || hasAttendance(registration)) return false;
  const start = new Date(registration.selectedSession).getTime();
  const end = start + (webinar.videoDuration || 3600) * 1000;
  return now.getTime() >= start + 600_000 && now.getTime() < end;
}
