import test from "node:test";
import assert from "node:assert/strict";
import { PlaybackMeasurement, mergeWatchedRanges, watchedSeconds } from "@shared/watch-measurement";

test("playback measures actual forward play, not room time, seeks, buffering or pauses", () => {
  const clock = new PlaybackMeasurement();
  clock.sample(0, 0, true);
  clock.sample(1, 1000, true);
  clock.sample(2, 2000, true);
  clock.sample(600, 3000, true); // seek: 598 seconds are not watched
  clock.sample(601, 4000, true);
  clock.sample(601, 5000, true); // buffering
  clock.sample(602, 6000, false); // hidden/paused
  clock.sample(900, 60000, true); // resume after a gap
  assert.equal(clock.elapsedSeconds, 3);
  assert.equal(watchedSeconds(clock.ranges), 3);
  assert.equal(clock.report("page-session", 900).totalWatched, 3);
  assert.notEqual(clock.report("page-session", 900).lastPosition, clock.report("page-session", 900).totalWatched);
});
test("replays, overlapping devices and out-of-order ranges cannot double unique coverage", () => {
  assert.equal(watchedSeconds([{ start: 0, end: 10 }, { start: 5, end: 20 }, { start: 0, end: 10 }]), 20);
  assert.deepEqual(mergeWatchedRanges([{ start: 20, end: 30 }, { start: 0, end: 10 }]), [{ start: 0, end: 10 }, { start: 20, end: 30 }]);
});
