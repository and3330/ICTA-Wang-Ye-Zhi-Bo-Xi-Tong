export type WatchedRange = { start: number; end: number };

/** Unique content coverage, not playhead position or time spent in the room. */
export function mergeWatchedRanges(ranges: WatchedRange[]): WatchedRange[] {
  const sorted = ranges.filter(r => Number.isFinite(r.start) && Number.isFinite(r.end) && r.start >= 0 && r.end > r.start)
    .map(r => ({ ...r })).sort((a, b) => a.start - b.start);
  const result: WatchedRange[] = [];
  for (const range of sorted) {
    const last = result[result.length - 1];
    if (last && range.start <= last.end + 0.05) last.end = Math.max(last.end, range.end);
    else result.push(range);
  }
  return result;
}
export const watchedSeconds = (ranges: WatchedRange[]) =>
  mergeWatchedRanges(ranges).reduce((sum, range) => sum + range.end - range.start, 0);

/** A page-local playback clock. Seeks, buffering, pauses and hidden tabs earn no time. */
export class PlaybackMeasurement {
  ranges: WatchedRange[] = [];
  elapsedSeconds = 0;
  private previous?: { position: number; now: number; playing: boolean };
  sample(position: number, now: number, playing: boolean) {
    const previous = this.previous;
    this.previous = { position, now, playing };
    if (!previous || !playing || !previous.playing) return;
    const wall = (now - previous.now) / 1000;
    const delta = position - previous.position;
    if (wall <= 0 || wall > 3 || delta <= 0 || delta > wall * 1.25 + 0.25) return;
    // Contiguous media intervals avoid accumulating floating-point callback
    // jitter gaps. The server independently caps total coverage by wall time.
    const credited = delta;
    this.elapsedSeconds += credited;
    this.ranges = mergeWatchedRanges([...this.ranges, { start: position - credited, end: position }]);
  }
  report(viewerSessionId: string, lastPosition: number) {
    return { viewerSessionId, lastPosition, totalWatched: this.elapsedSeconds,
      measurementVersion: 2 as const, watchedRanges: this.ranges };
  }
}
