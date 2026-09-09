import type { Webinar, WebinarSession } from "@shared/schema";

export type AvailableSession = {
  id: string;
  scheduledStart: Date;
  status: string;
};

export type AvailableSessions = {
  mode: "justInTime" | "recurring" | "fixed" | "onDemand";
  sessions: AvailableSession[];
  hasSessions: boolean;
  onDemandAvailable: boolean;
  registrationOpen: boolean;
  nextStartMinutes?: number;
  message?: string;
};

function civilDate(value: unknown, name: string): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${name} must be a YYYY-MM-DD date`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`${name} must be a valid calendar date`);
  }
  return value;
}

export function scheduleDateBounds(scheduleMode: unknown): { start: string | null; end: string | null } {
  const mode = (scheduleMode || {}) as Record<string, unknown>;
  const start = civilDate(mode.eventStartDate, "eventStartDate");
  const end = civilDate(mode.eventEndDate, "eventEndDate");
  if (start && end && start > end) throw new Error("eventStartDate must be on or before eventEndDate");
  return { start, end };
}

export function isValidIanaTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

// Converts a civil time in an IANA zone to an instant. The final equality
// check rejects nonexistent local times during a spring-forward transition.
export function zonedDateTimeToDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date | null {
  const target = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let candidate = target;
  for (let attempt = 0; attempt < 4; attempt++) {
    const represented = zonedParts(new Date(candidate), timeZone);
    const representedAsUtc = Date.UTC(
      represented.year,
      represented.month - 1,
      represented.day,
      represented.hour,
      represented.minute,
      represented.second,
    );
    const adjustment = target - representedAsUtc;
    if (adjustment === 0) break;
    candidate += adjustment;
  }
  const result = new Date(candidate);
  const actual = zonedParts(result, timeZone);
  if (
    actual.year !== year ||
    actual.month !== month ||
    actual.day !== day ||
    actual.hour !== hour ||
    actual.minute !== minute
  ) {
    return null;
  }
  return result;
}

export function generateRecurringSessions(
  webinar: Webinar,
  now: Date,
  horizonDays = 14,
  maximum = 20,
): AvailableSession[] {
  const recurring = webinar.recurringSchedule;
  if (!recurring?.enabled || !recurring.days?.length || !recurring.times?.length) return [];
  const bounds = scheduleDateBounds(webinar.scheduleMode);

  const timeZone = webinar.timezone && isValidIanaTimezone(webinar.timezone)
    ? webinar.timezone
    : "Asia/Taipei";
  const today = zonedParts(now, timeZone);
  const civilStart = new Date(Date.UTC(today.year, today.month - 1, today.day));
  const exclusions = new Set((recurring.excludeDates || []).map((date) => String(date).slice(0, 10)));
  const generated: AvailableSession[] = [];
  const webinarStart = zonedParts(new Date(webinar.startTime), timeZone);
  const recurrenceAnchor = bounds.start
    ? new Date(`${bounds.start}T00:00:00.000Z`)
    : new Date(Date.UTC(
      webinarStart.year,
      webinarStart.month - 1,
      webinarStart.day,
    ));

  for (let offset = 0; offset < horizonDays && generated.length < maximum; offset++) {
    const civil = new Date(civilStart);
    civil.setUTCDate(civil.getUTCDate() + offset);
    if (!recurring.days.includes(civil.getUTCDay())) continue;
    if (
      (recurring as typeof recurring & { frequency?: string }).frequency === "biweekly" &&
      Math.floor((civil.getTime() - recurrenceAnchor.getTime()) / (7 * 86_400_000)) % 2 !== 0
    ) continue;
    const ymd = [
      civil.getUTCFullYear(),
      String(civil.getUTCMonth() + 1).padStart(2, "0"),
      String(civil.getUTCDate()).padStart(2, "0"),
    ].join("-");
    if ((bounds.start && ymd < bounds.start) || (bounds.end && ymd > bounds.end)) continue;
    if (exclusions.has(ymd)) continue;

    for (const configuredTime of recurring.times) {
      const match = /^(\d{1,2}):(\d{2})$/.exec(String(configuredTime).trim());
      if (!match) continue;
      const hour = Number(match[1]);
      const minute = Number(match[2]);
      if (hour > 23 || minute > 59) continue;
      const slot = zonedDateTimeToDate(
        civil.getUTCFullYear(),
        civil.getUTCMonth() + 1,
        civil.getUTCDate(),
        hour,
        minute,
        timeZone,
      );
      if (!slot || slot.getTime() <= now.getTime()) continue;
      generated.push({
        id: `recurring-${slot.getTime()}`,
        scheduledStart: slot,
        status: "scheduled",
      });
      if (generated.length >= maximum) break;
    }
  }
  return generated;
}

export function getAvailableSessions(
  webinar: Webinar,
  persistedSessions: WebinarSession[],
  now = new Date(),
): AvailableSessions {
  const scheduleMode = webinar.scheduleMode;
  const onDemandAvailable = Boolean(scheduleMode?.onDemand);

  // JIT is intentionally not mixed with persisted or recurring schedules.
  if (scheduleMode?.justInTime) {
    const minutes = Math.max(1, scheduleMode.justInTimeMinutes || 15);
    const nextStart = new Date(Math.ceil(now.getTime() / 60_000) * 60_000 + minutes * 60_000);
    return {
      mode: "justInTime",
      sessions: [{ id: "jit", scheduledStart: nextStart, status: "scheduled" }],
      hasSessions: true,
      onDemandAvailable,
      registrationOpen: true,
      nextStartMinutes: minutes,
      message: `下一場將在 ${minutes} 分鐘內開始`,
    };
  }

  const sessions = [
    ...generateRecurringSessions(webinar, now),
    ...persistedSessions
      .filter((session) =>
        session.webinarId === webinar.id &&
        session.status === "scheduled" &&
        new Date(session.scheduledStart).getTime() > now.getTime())
      .map((session) => ({ ...session, scheduledStart: new Date(session.scheduledStart) })),
  ];

  if (sessions.length === 0) {
    const mainStart = new Date(webinar.startTime);
    if (mainStart.getTime() > now.getTime()) {
      sessions.push({ id: "main", scheduledStart: mainStart, status: "scheduled" });
    }
  }

  const unique = Array.from(new Map(
    sessions
      .sort((a, b) => a.scheduledStart.getTime() - b.scheduledStart.getTime())
      .map((session) => [session.scheduledStart.getTime(), session]),
  ).values()).slice(0, 20);
  const recurring = Boolean(scheduleMode?.recurring || webinar.recurringSchedule?.enabled);

  return {
    mode: recurring ? "recurring" : onDemandAvailable && unique.length === 0 ? "onDemand" : "fixed",
    sessions: unique,
    hasSessions: unique.length > 0,
    onDemandAvailable,
    registrationOpen: onDemandAvailable || unique.length > 0,
  };
}

export function normalizeSelectedSession(
  selectedSession: Date | string | null | undefined,
  availability: AvailableSessions,
  now = new Date(),
): Date | null {
  if (selectedSession == null || selectedSession === "") {
    if (availability.onDemandAvailable) return null;
    throw new Error("請選擇有效的場次");
  }
  const requested = new Date(selectedSession);
  if (!Number.isFinite(requested.getTime()) || requested.getTime() <= now.getTime()) {
    throw new Error("所選場次無效或已過期");
  }

  if (availability.mode === "justInTime") {
    const jit = availability.sessions[0]?.scheduledStart;
    // A JIT slot returned shortly before registration remains valid even if
    // the current minute has rolled over.
    const latest = availability.sessions[0]?.scheduledStart.getTime() ?? 0;
    if (!jit || requested.getTime() > latest || requested.getTime() < now.getTime()) {
      throw new Error("所選即時場次無效或已過期");
    }
    return requested;
  }

  const exact = availability.sessions.find(
    (session) => session.scheduledStart.getTime() === requested.getTime(),
  );
  if (!exact) throw new Error("所選場次不屬於此直播間或無法報名");
  return new Date(exact.scheduledStart);
}