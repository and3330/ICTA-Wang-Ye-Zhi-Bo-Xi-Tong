import { and, asc, eq, sql } from "drizzle-orm";
import { registrations, webinarFunnelEvents } from "@shared/schema";
import { realFunnelEvent, realRegistration } from "../analyticsIsolation";
import type { Tx } from "./oauthProvider";

export const publicFunnelTypes = ["registration", "webinar_enter", "video_progress", "sales_segment_reached", "dropoff", "cta_view", "cta_click", "checkout_start"];
// Drizzle single-table SELECT selection strips column qualifications, including
// interpolated columns inside scalar subqueries. Keep outer correlations explicit.
export const outerRegistrationId = sql.raw('"registrations"."id"');
export const outerWebinarId = sql.raw('"registrations"."webinar_id"');
export const measuredRegistrationColumns = {
  watchDurationSeconds: sql<number>`CASE WHEN ${registrations.watchMeasurementVersion} = 2 THEN coalesce(${registrations.watchDuration},0) ELSE 0 END`,
  watchMeasurementVersion: registrations.watchMeasurementVersion,
  lastPositionSeconds: sql<number>`coalesce((SELECT p.last_position FROM viewer_progress p
    WHERE p.registration_id = ${outerRegistrationId} AND p.webinar_id = ${outerWebinarId}
    ORDER BY p.updated_at DESC,p.id DESC LIMIT 1),0)`,
  enteredAt: registrations.attendedAt,
  salesSegmentReachedAt: sql<string | null>`(SELECT min(e.occurred_at) FROM webinar_funnel_events e
    WHERE e.registration_id = ${outerRegistrationId} AND e.webinar_id = ${outerWebinarId}
    AND e.event_type = 'sales_segment_reached' AND e.is_test = false)`,
  salesCtaClicks: sql<number>`(SELECT count(*)::int FROM webinar_funnel_events e
    WHERE e.registration_id = ${outerRegistrationId} AND e.webinar_id = ${outerWebinarId}
    AND e.event_type = 'cta_click' AND e.is_test = false)`,
};
export async function registrationInsight(tx: Tx, webinarId: string, registrationId: string) {
  const [row] = await tx.select({ registrationId: registrations.id, webinarId: registrations.webinarId,
    attended: registrations.attended, ...measuredRegistrationColumns }).from(registrations)
    .where(and(eq(registrations.webinarId, webinarId), eq(registrations.id, registrationId), realRegistration));
  if (!row) throw new Error("Registration unavailable");
  return { ...row, salesSegmentReached: row.salesSegmentReachedAt != null,
    watchDurationDefinition: "v2_unique_measured_content_seconds; legacy_unmeasured_returns_zero" };
}
export async function listFunnelEvents(tx: Tx, webinarId: string, limit: number, offset: number, registrationId?: string) {
  const rows = await tx.select({
    eventId: webinarFunnelEvents.id, eventType: webinarFunnelEvents.eventType,
    webinarId: webinarFunnelEvents.webinarId, registrationId: webinarFunnelEvents.registrationId,
    sessionId: webinarFunnelEvents.sessionId, ctaId: webinarFunnelEvents.ctaId,
    positionSeconds: webinarFunnelEvents.positionSeconds, occurredAt: webinarFunnelEvents.occurredAt,
  }).from(webinarFunnelEvents).where(and(
    eq(webinarFunnelEvents.webinarId, webinarId), realFunnelEvent,
    sql`${webinarFunnelEvents.eventType} IN ('registration','webinar_enter','video_progress','sales_segment_reached','dropoff','cta_view','cta_click','checkout_start')`,
    sql`NOT EXISTS (SELECT 1 FROM registrations r WHERE r.id = ${webinarFunnelEvents.registrationId} AND r.deleted_at IS NOT NULL)`,
    registrationId ? eq(webinarFunnelEvents.registrationId, registrationId) : undefined,
  )).orderBy(asc(webinarFunnelEvents.occurredAt), asc(webinarFunnelEvents.id)).limit(limit + 1).offset(offset);
  return { events: rows.slice(0, limit), nextOffset: rows.length > limit ? offset + limit : null };
}
