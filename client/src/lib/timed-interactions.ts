export type TimedItem = {
  id: string;
  triggerTime: number;
  duration?: number | null;
};

export type TimedPick<T> = { item: T; remainingSeconds: number };

/**
 * Picks the timed item (tip or poll) to show at `currentTime`.
 *
 * Every item whose trigger time has passed is marked in `shown`, so it is
 * considered only once. Of those, only an item whose display window is still
 * open is returned, with the part of the window that is left: a viewer who
 * joins late or seeks forward sees the current item, not every past one.
 * When several windows are open, the most recently triggered item wins.
 */
export function pickTimedItem<T extends TimedItem>(
  items: readonly T[],
  currentTime: number,
  shown: Set<string>,
  defaultSeconds: number,
): TimedPick<T> | null {
  let picked: TimedPick<T> | null = null;
  for (const item of items) {
    if (currentTime < item.triggerTime || shown.has(item.id)) continue;
    shown.add(item.id);
    const remainingSeconds = item.triggerTime + (item.duration || defaultSeconds) - currentTime;
    if (remainingSeconds <= 0) continue;
    if (!picked || item.triggerTime >= picked.item.triggerTime) picked = { item, remainingSeconds };
  }
  return picked;
}

export const DEFAULT_TIP_SECONDS = 10;
export const DEFAULT_POLL_SECONDS = 60;
