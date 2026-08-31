import type { Webinar } from "@shared/schema";

export function canViewWebinar(
  webinar: Pick<Webinar, "userId" | "publishStatus"> | undefined,
  sessionUserId: string | null | undefined,
): boolean {
  if (!webinar) return false;
  return webinar.publishStatus === "published"
    || Boolean(sessionUserId && webinar.userId === sessionUserId);
}