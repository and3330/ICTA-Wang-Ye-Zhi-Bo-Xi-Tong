/**
 * Where a returning viewer should pick the video up. A registration keeps its
 * place across reloads, dropped connections and devices; signing up again
 * creates a new registration, which starts from the beginning.
 */
export function pickResumePosition({ local, server, duration }: {
  local?: number | null;
  server?: number | null;
  duration?: number | null;
}): number {
  const candidates = [local, server].filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
  if (candidates.length === 0) return 0;
  const position = Math.floor(Math.max(...candidates));
  // A few seconds in is not worth a jump; a finished video starts over.
  if (position < 5) return 0;
  if (duration && duration > 0 && position >= duration - 5) return 0;
  return position;
}

export const resumeStorageKey = (webinarId: string, registrationId: string) => `resume_${webinarId}_${registrationId}`;
