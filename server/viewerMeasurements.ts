import crypto from "node:crypto";
import { z } from "zod";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import { registrations, viewerProgress, webinars, webinarSessions, ctaButtons, webinarFunnelEvents } from "@shared/schema";
import { mergeWatchedRanges, watchedSeconds } from "@shared/watch-measurement";

export const progressReportSchema = z.object({
  viewerSessionId: z.string().trim().min(1).max(200),
  lastPosition: z.number().finite().min(0).max(86400).transform(Math.floor),
  totalWatched: z.number().finite().min(0).max(86400),
  measurementVersion: z.literal(2).optional(),
  watchedRanges: z.array(z.object({
    start: z.number().finite().min(0).max(86400),
    end: z.number().finite().min(0).max(86400),
  }).refine(r => r.end > r.start)).max(300).optional(),
});
export type ProgressReport = z.infer<typeof progressReportSchema>;

export async function recordViewerProgress(webinarId: string, registrationId: string, report: ProgressReport, now = new Date()) {
  return db.transaction(async tx => {
    // One registration lock serializes devices, retries, and range aggregation.
    const [registration] = await tx.select().from(registrations)
      .where(and(eq(registrations.id, registrationId), eq(registrations.webinarId, webinarId), isNull(registrations.deletedAt))).for("update");
    if (!registration) throw new Error("Registration unavailable");
    const [webinar] = await tx.select().from(webinars).where(eq(webinars.id, webinarId));
    const [existing] = await tx.select().from(viewerProgress).where(and(
      eq(viewerProgress.webinarId, webinarId), eq(viewerProgress.viewerSessionId, report.viewerSessionId),
    ));
    if (existing?.registrationId && existing.registrationId !== registrationId) {
      throw Object.assign(new Error("Progress session belongs to another viewer"), { status: 409 });
    }
    // Legacy clients can save their resume position, but cannot manufacture v2 seconds.
    if (!report.measurementVersion) {
      if (existing?.measurementVersion === 2) return existing;
      const values = { webinarId, registrationId, viewerSessionId: report.viewerSessionId,
        lastPosition: report.lastPosition, totalWatched: 0, updatedAt: now };
      const [row] = existing
        ? await tx.update(viewerProgress).set(values).where(eq(viewerProgress.id, existing.id)).returning()
        : await tx.insert(viewerProgress).values(values).returning();
      return row;
    }
    if (!report.watchedRanges) throw new Error("Measured progress requires watchedRanges");
    if (existing && existing.measurementVersion !== 2) throw new Error("Use a new measurement session for v2 progress");
    const ranges = mergeWatchedRanges(report.watchedRanges);
    const duration = webinar?.videoDuration || 86400;
    if (ranges.some(r => r.end > duration + 1)) throw new Error("Watched range exceeds video duration");
    const startedAt = existing?.startedAt ?? new Date(now.getTime() - Math.min(report.totalWatched, 15) * 1000);
    const budget = Math.max(0, (now.getTime() - startedAt.getTime()) / 1000);
    if (watchedSeconds(ranges) > Math.min(report.totalWatched, budget) + 0.25) {
      throw new Error("Watched ranges exceed measured playback or heartbeat elapsed time");
    }
    const merged = mergeWatchedRanges([...(existing?.watchedRanges || []), ...ranges]);
    if (merged.length > 300) throw new Error("Too many watched ranges");
    const values = { webinarId, registrationId, viewerSessionId: report.viewerSessionId, measurementVersion: 2,
      lastPosition: report.lastPosition, totalWatched: Math.floor(watchedSeconds(merged)), watchedRanges: merged, startedAt, updatedAt: now };
    const [progress] = existing
      ? await tx.update(viewerProgress).set(values).where(eq(viewerProgress.id, existing.id)).returning()
      : await tx.insert(viewerProgress).values(values).returning();
    const allProgress = await tx.select({ ranges: viewerProgress.watchedRanges, startedAt: viewerProgress.startedAt }).from(viewerProgress).where(and(
      eq(viewerProgress.webinarId, webinarId), eq(viewerProgress.registrationId, registrationId), eq(viewerProgress.measurementVersion, 2),
    ));
    const allRanges = mergeWatchedRanges(allProgress.flatMap(p => p.ranges || []));
    const earliestStart = Math.min(...allProgress.map(p => p.startedAt.getTime()));
    if (watchedSeconds(allRanges) > Math.max(0, (now.getTime() - earliestStart) / 1000) + 0.25) {
      throw new Error("Combined device playback exceeds registration heartbeat elapsed time");
    }
    const seconds = Math.floor(watchedSeconds(allRanges));
    await tx.update(registrations).set({ watchDuration: seconds, watchMeasurementVersion: 2 })
      .where(eq(registrations.id, registrationId));
    const [sales] = await tx.select({ start: sql<number>`min(${ctaButtons.startTime})` }).from(ctaButtons).where(and(
      eq(ctaButtons.webinarId, webinarId), isNull(ctaButtons.archivedAt), eq(ctaButtons.liveOnly, false),
    ));
    // A seek alone never reaches the sales segment: actual measured playback is required.
    if (sales?.start != null && ranges.some(r => r.end > sales.start && r.end - Math.max(r.start, sales.start) >= 0.5)) {
      const [session] = registration.selectedSession ? await tx.select({ id: webinarSessions.id }).from(webinarSessions)
        .where(and(eq(webinarSessions.webinarId, webinarId), eq(webinarSessions.scheduledStart, registration.selectedSession))).limit(1) : [];
      const dedupeKey = crypto.createHash("sha256").update(`sales_segment_reached:${registrationId}:${registration.selectedSession?.toISOString() || "on-demand"}`).digest("hex");
      await tx.insert(webinarFunnelEvents).values({
        webinarId, registrationId, eventType: "sales_segment_reached", dedupeKey,
        sessionId: session?.id || null,
        positionSeconds: Math.floor(sales.start), isTest: registration.isTest || !!webinar?.isTest,
        metadata: { serverRecorded: true }, occurredAt: now,
      }).onConflictDoNothing({ target: [webinarFunnelEvents.webinarId, webinarFunnelEvents.dedupeKey] });
    }
    return progress;
  });
}
