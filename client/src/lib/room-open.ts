import { useEffect, useState } from "react";

/** The room button appears this many minutes before the start. */
export const ROOM_OPENS_MINUTES_BEFORE = 15;

/**
 * Whether a registrant should be offered "enter the room" right now: always
 * for on-demand, otherwise from shortly before the start time onward. A
 * missing or unreadable start time keeps the button (never lock people out).
 */
export function isRoomOpenSoon(
  start: string | Date | null | undefined,
  onDemand: boolean,
  now = Date.now(),
  minutesBefore = ROOM_OPENS_MINUTES_BEFORE,
): boolean {
  if (onDemand || !start) return true;
  const startMs = new Date(start).getTime();
  if (!Number.isFinite(startMs)) return true;
  return now >= startMs - minutesBefore * 60_000;
}

/** Same check, re-evaluated every 30 s so the button appears on time. */
export function useRoomOpenSoon(start: string | Date | null | undefined, onDemand: boolean): boolean {
  const [now, setNow] = useState(() => Date.now());
  const open = isRoomOpenSoon(start, onDemand, now);
  useEffect(() => {
    if (open) return;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [open]);
  return open;
}
