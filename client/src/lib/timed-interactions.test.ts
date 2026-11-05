import test from "node:test";
import assert from "node:assert/strict";
import { pickTimedItem } from "./timed-interactions.ts";

const items = [
  { id: "a", triggerTime: 10, duration: 30 },
  { id: "b", triggerTime: 60, duration: 30 },
  { id: "c", triggerTime: 200, duration: null },
];

test("shows nothing before the first trigger time", () => {
  assert.equal(pickTimedItem(items, 5, new Set(), 60), null);
});

test("shows an item once, for the time left in its window", () => {
  const shown = new Set<string>();
  assert.deepEqual(pickTimedItem(items, 15, shown, 60), { item: items[0], remainingSeconds: 25 });
  assert.equal(pickTimedItem(items, 16, shown, 60), null);
});

test("skips items whose window has closed for a late joiner", () => {
  const shown = new Set<string>();
  assert.deepEqual(pickTimedItem(items, 70, shown, 60), { item: items[1], remainingSeconds: 20 });
  assert.equal(shown.has("a"), true);
  assert.equal(pickTimedItem(items, 100, new Set(), 60), null);
});

test("uses the default length when an item has none", () => {
  assert.deepEqual(pickTimedItem(items, 210, new Set(), 60), { item: items[2], remainingSeconds: 50 });
});
