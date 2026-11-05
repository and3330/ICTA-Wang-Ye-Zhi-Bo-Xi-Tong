import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  webinars,
  registrations,
  webinarSessions,
  type Webinar,
  type WebinarSession,
} from "@shared/schema";
import {
  canonicalSessionTimeMs,
  sessionTimeISO,
  type SessionRegistrationCountLabelKind,
  type SessionRegistrationCountStatus,
  type SessionRegistrationCountsDto,
  type SessionRegistrationCountRow,
} from "@shared/sessionRegistrationCounts";
import { db } from "./db";
import { getAvailableSessions } from "./webinarScheduling";

type RegistrationAggregate = {
  webinarId: string;
  selectedSession: unknown;
  registrationCount: unknown;
};

type WebinarSessionMetadata = {
  webinar: Webinar;
  session: WebinarSession | null;
};

type SessionCandidate = {
  key: string;
  startTimeMs: number;
  labelKind: SessionRegistrationCountLabelKind;
  status: SessionRegistrationCountStatus;
  registrationCount: number;
};

const statusRank: Record<SessionRegistrationCountStatus, number> = {
  unknown: 0,
  cancelled: 1,
  ended: 2,
  scheduled: 3,
  live: 4,
};

function normalizedStatus(value: unknown): SessionRegistrationCountStatus {
  if (value === "scheduled" || value === "live" || value === "ended") return value;
  if (value === "cancelled" || value === "canceled") return "cancelled";
  return "unknown";
}

function inferredStatus(startTimeMs: number, nowMs: number): SessionRegistrationCountStatus {
  return startTimeMs <= nowMs ? "ended" : "scheduled";
}

function timedKey(labelKind: SessionRegistrationCountLabelKind, startTimeMs: number): string {
  return `${labelKind}-${startTimeMs}`;
}

function addCandidate(
  candidates: Map<number, SessionCandidate>,
  startTimeMs: number,
  labelKind: SessionRegistrationCountLabelKind,
  status: SessionRegistrationCountStatus,
) {
  const existing = candidates.get(startTimeMs);
  if (existing) {
    // Multiple persisted records can represent the same instant.  Keep one
    // timestamp-keyed row and retain the most informative status.
    if (statusRank[status] > statusRank[existing.status]) existing.status = status;
    return existing;
  }
  const candidate: SessionCandidate = {
    key: timedKey(labelKind, startTimeMs),
    startTimeMs,
    labelKind,
    status,
    registrationCount: 0,
  };
  candidates.set(startTimeMs, candidate);
  return candidate;
}

function addRegistrationCount(
  candidates: Map<number, SessionCandidate>,
  startTimeMs: number,
  labelKind: SessionRegistrationCountLabelKind,
  status: SessionRegistrationCountStatus,
  count: number,
) {
  const candidate = addCandidate(candidates, startTimeMs, labelKind, status);
  candidate.registrationCount += count;
}

function asCount(value: unknown): number {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.trunc(count) : 0;
}

function buildSessionRegistrationCounts(
  webinar: Webinar,
  persistedSessions: WebinarSession[],
  registrationAggregates: RegistrationAggregate[],
  now: Date,
): SessionRegistrationCountsDto {
  const nowMs = now.getTime();
  const candidates = new Map<number, SessionCandidate>();
  const aggregateByTime = new Map<number, number>();
  let totalRegistered = 0;

  // Stored rows are authoritative metadata and are emitted even with zero
  // registrations. Sorting makes duplicate-start status selection stable.
  for (const session of [...persistedSessions].sort((a, b) => {
    const startDifference = new Date(a.scheduledStart).getTime() - new Date(b.scheduledStart).getTime();
    return startDifference || a.id.localeCompare(b.id);
  })) {
    const startTimeMs = canonicalSessionTimeMs(session.scheduledStart);
    if (startTimeMs === null) continue;
    addCandidate(candidates, startTimeMs, "session", normalizedStatus(session.status));
  }

  const scheduleMode = webinar.scheduleMode || undefined;
  const recurringEnabled = Boolean(scheduleMode?.recurring || webinar.recurringSchedule?.enabled);
  const justInTimeEnabled = Boolean(scheduleMode?.justInTime);
  const onDemandEnabled = Boolean(scheduleMode?.onDemand);
  let onDemandCount = 0;
  let unassignedCount = 0;

  // getAvailableSessions intentionally bounds only generated upcoming
  // recurrence slots. Historical selected timestamps are added below from the
  // SQL aggregate and are never truncated.
  const availability = getAvailableSessions(webinar, persistedSessions, now);
  {
    for (const session of availability.sessions) {
      if (session.id === "jit") continue;
      const startTimeMs = canonicalSessionTimeMs(session.scheduledStart);
      if (startTimeMs === null) continue;
      const generatedRecurring = session.id.startsWith("recurring-");
      addCandidate(
        candidates,
        startTimeMs,
        generatedRecurring ? "recurring" : "session",
        normalizedStatus(session.status),
      );
    }
  }

  // A fixed webinar has one main slot even when it is already historical.
  // on-demand-only webinars do not get a fabricated main zero row.
  const mainStartMs = canonicalSessionTimeMs(webinar.startTime);
  if (
    mainStartMs !== null &&
    !justInTimeEnabled &&
    !recurringEnabled &&
    (!onDemandEnabled || mainStartMs > nowMs)
  ) {
    addCandidate(candidates, mainStartMs, "session", normalizedStatus(webinar.status));
  }

  for (const aggregate of registrationAggregates) {
    const registrationCount = asCount(aggregate.registrationCount);
    totalRegistered += registrationCount;
    const selectedTimeMs = canonicalSessionTimeMs(aggregate.selectedSession);
    if (selectedTimeMs !== null) {
      aggregateByTime.set(
        selectedTimeMs,
        (aggregateByTime.get(selectedTimeMs) || 0) + registrationCount,
      );
    } else if (aggregate.selectedSession === null || aggregate.selectedSession === undefined || aggregate.selectedSession === "") {
      if (onDemandEnabled) onDemandCount += registrationCount;
      else unassignedCount += registrationCount;
    } else {
      // A real database timestamp cannot be unparseable, but keeping this
      // branch explicit prevents malformed adapter values from becoming an
      // on-demand registration.
      unassignedCount += registrationCount;
    }
  }

  for (const [selectedTimeMs, registrationCount] of Array.from(aggregateByTime.entries())) {
    const existing = candidates.get(selectedTimeMs);
    if (existing) {
      existing.registrationCount += registrationCount;
      continue;
    }

    let labelKind: SessionRegistrationCountLabelKind;
    if (justInTimeEnabled) {
      // JIT's current synthetic slot changes with the clock. Only persisted
      // selected instants become rows; no current-time zero slot is created.
      labelKind = "justInTime";
    } else if (recurringEnabled) {
      labelKind = "recurring";
    } else if (mainStartMs !== null && selectedTimeMs === mainStartMs) {
      labelKind = "session";
    } else {
      // A fixed webinar can have registrations for historical slots whose
      // persisted metadata was later rescheduled/deleted. Keep every
      // parseable instant as its own session row rather than hiding it in the
      // unassigned bucket.
      labelKind = "session";
    }

    addRegistrationCount(
      candidates,
      selectedTimeMs,
      labelKind,
      inferredStatus(selectedTimeMs, nowMs),
      registrationCount,
    );
  }

  const rows: SessionRegistrationCountRow[] = Array.from(candidates.values())
    .sort((a, b) => a.startTimeMs - b.startTimeMs || a.key.localeCompare(b.key))
    .map((candidate) => ({
      key: candidate.key,
      startTimeISO: sessionTimeISO(candidate.startTimeMs),
      labelKind: candidate.labelKind,
      status: candidate.status,
      registrationCount: Math.trunc(candidate.registrationCount),
    }));

  // Explicit on-demand mode always exposes its bucket, including when it is
  // currently empty. Unassigned is a real bucket only when it has data.
  if (onDemandEnabled) {
    rows.push({
      key: "onDemand",
      startTimeISO: null,
      labelKind: "onDemand",
      status: "unknown",
      registrationCount: onDemandCount,
    });
  }
  if (unassignedCount > 0) {
    rows.push({
      key: "unassigned",
      startTimeISO: null,
      labelKind: "unassigned",
      status: "unknown",
      registrationCount: unassignedCount,
    });
  }

  return { counts: rows, totalRegistered };
}

async function loadRegistrationAggregates(
  ownerId: string,
  webinarIds: string[],
): Promise<RegistrationAggregate[]> {
  if (webinarIds.length === 0) return [];
  // date_trunc(..., milliseconds) is intentional: PostgreSQL can retain
  // microseconds while registration/session instants are canonicalized to JS
  // milliseconds by the DTO.
  const selectedSessionMilliseconds = sql`date_trunc('milliseconds', ${registrations.selectedSession})`;
  return db
    .select({
      webinarId: registrations.webinarId,
      selectedSession: selectedSessionMilliseconds,
      registrationCount: sql<number>`count(*)::int`,
    })
    .from(registrations)
    .innerJoin(webinars, eq(registrations.webinarId, webinars.id))
    .where(and(
      eq(webinars.userId, ownerId),
      isNull(webinars.deletedAt),
      isNull(registrations.deletedAt),
      inArray(webinars.id, webinarIds),
    ))
    .groupBy(registrations.webinarId, selectedSessionMilliseconds);
}

async function loadSessionMetadata(
  ownerId: string,
  webinarIds: string[],
): Promise<WebinarSessionMetadata[]> {
  if (webinarIds.length === 0) return [];
  const rows = await db
    .select({ webinar: webinars, session: webinarSessions })
    .from(webinars)
    .leftJoin(webinarSessions, eq(webinarSessions.webinarId, webinars.id))
    .where(and(
      eq(webinars.userId, ownerId),
      isNull(webinars.deletedAt),
      inArray(webinars.id, webinarIds),
    ))
    .orderBy(asc(webinars.id), asc(webinarSessions.scheduledStart), asc(webinarSessions.id));
  return rows as WebinarSessionMetadata[];
}

/**
 * One aggregate registration query and one session/webinar metadata query for
 * every requested owner webinar. This is also used by the collapsed dashboard
 * cards so adding this detail does not create one registration scan per card.
 */
export async function getBatchSessionRegistrationCounts(
  ownerId: string,
  webinarIds: string[],
  now = new Date(),
): Promise<Record<string, SessionRegistrationCountsDto>> {
  const uniqueWebinarIds = Array.from(new Set(webinarIds));
  if (uniqueWebinarIds.length === 0) return {};

  const [registrationRows, metadataRows] = await Promise.all([
    loadRegistrationAggregates(ownerId, uniqueWebinarIds),
    loadSessionMetadata(ownerId, uniqueWebinarIds),
  ]);

  const registrationsByWebinar = new Map<string, RegistrationAggregate[]>();
  for (const row of registrationRows) {
    const entries = registrationsByWebinar.get(row.webinarId) || [];
    entries.push(row);
    registrationsByWebinar.set(row.webinarId, entries);
  }

  const metadataByWebinar = new Map<string, { webinar: Webinar; sessions: WebinarSession[] }>();
  for (const { webinar, session } of metadataRows) {
    const existing = metadataByWebinar.get(webinar.id);
    if (existing) {
      if (session) existing.sessions.push(session);
    } else {
      metadataByWebinar.set(webinar.id, { webinar, sessions: session ? [session] : [] });
    }
  }

  const result: Record<string, SessionRegistrationCountsDto> = {};
  for (const webinarId of uniqueWebinarIds) {
    const metadata = metadataByWebinar.get(webinarId);
    if (!metadata) continue;
    result[webinarId] = buildSessionRegistrationCounts(
      metadata.webinar,
      metadata.sessions,
      registrationsByWebinar.get(webinarId) || [],
      now,
    );
  }
  return result;
}

export async function getSessionRegistrationCounts(
  ownerId: string,
  webinarId: string,
  now = new Date(),
): Promise<SessionRegistrationCountsDto | undefined> {
  const result = await getBatchSessionRegistrationCounts(ownerId, [webinarId], now);
  return result[webinarId];
}

// Explicit aliases make the owner-scoped API easy to discover without
// introducing a second implementation or query path.
export const getSessionRegistrationCountsForOwner = getSessionRegistrationCounts;
export const getBatchSessionRegistrationCountsForOwner = getBatchSessionRegistrationCounts;

export { buildSessionRegistrationCounts };