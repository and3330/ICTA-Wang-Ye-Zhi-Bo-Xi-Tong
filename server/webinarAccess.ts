import type { Webinar } from "@shared/schema";

export function canViewWebinar(
  webinar: Pick<Webinar, "userId" | "publishStatus"> | undefined,
  sessionUserId: string | null | undefined,
  isSuperAdmin = false,
): boolean {
  if (!webinar) return false;
  return webinar.publishStatus === "published"
    || isSuperAdmin
    || Boolean(sessionUserId && webinar.userId === sessionUserId);
}

export function webinarWatchEligibility(
  webinar: Pick<Webinar, "status" | "videoDuration" | "replayEnabled" | "replayAvailableHours">,
  registration: { selectedSession: Date | null },
  now = Date.now(),
) {
  const selectedSession = registration.selectedSession ? new Date(registration.selectedSession) : null;
  if (!selectedSession) {
    const canWatch = !(webinar.status === "ended" && webinar.replayEnabled === false);
    return { canWatch, selectedSession, liveEndsAt: null as Date | null, replayEndsAt: null as Date | null };
  }
  const start = selectedSession.getTime();
  const liveEnd = start + Math.max(0, webinar.videoDuration || 0) * 1000;
  const replayEnd = liveEnd + Math.max(0, webinar.replayAvailableHours ?? 48) * 60 * 60 * 1000;
  const canWatch = now >= start && (now <= liveEnd ||
    (webinar.replayEnabled !== false && now <= replayEnd));
  return {
    canWatch,
    selectedSession,
    liveEndsAt: new Date(liveEnd),
    replayEndsAt: new Date(replayEnd),
  };
}

export function canRetainViewerWsAccess(
  publishStatus: string,
  ownerEntitled: boolean,
  watchEligible: boolean,
): boolean {
  return publishStatus === "published" && ownerEntitled && watchEligible;
}