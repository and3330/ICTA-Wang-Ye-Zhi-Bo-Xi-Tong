import type { WatchState } from "@/lib/watch-access";

export type ViewerAccessKind =
  | "verified"
  | "upcoming"
  | "expired"
  | "unavailable"
  | "revoked"
  | "verifying"
  | "verification-failed";

type AccessInput = {
  hasToken: boolean;
  watchState?: WatchState;
  isInitialLoading?: boolean;
  verificationFailed?: boolean;
  fallbackVideoUrl?: string | null;
  scheduledStart?: string | Date | null;
  now?: Date;
};

export function resolveViewerAccessState({
  hasToken,
  watchState,
  isInitialLoading = false,
  verificationFailed = false,
  fallbackVideoUrl,
  scheduledStart,
  now = new Date(),
}: AccessInput): ViewerAccessKind {
  if (!hasToken) return fallbackVideoUrl ? "verified" : "unavailable";
  if (verificationFailed) return "verification-failed";
  if (isInitialLoading && !watchState) return "verifying";
  if (watchState?.accessRevoked) return "revoked";
  if (watchState?.canWatch && watchState.vimeoUrl) return "verified";

  const availableAt = watchState?.waitUntil || watchState?.selectedSession || scheduledStart;
  if (availableAt && new Date(availableAt).getTime() > now.getTime()) return "upcoming";
  return availableAt ? "expired" : "unavailable";
}

export function isPlaybackPermitted(access: ViewerAccessKind) {
  return access === "verified";
}