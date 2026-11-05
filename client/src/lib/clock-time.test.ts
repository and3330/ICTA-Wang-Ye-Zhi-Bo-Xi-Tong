import test from "node:test";
import assert from "node:assert/strict";
import { parseClock } from "./clock-time.ts";

test("reads minutes and seconds", () => {
  assert.equal(parseClock("5:30"), 330);
  assert.equal(parseClock(" 0:05 "), 5);
  assert.equal(parseClock("75:00"), 4500);
});

test("reads hours, minutes and seconds", () => {
  assert.equal(parseClock("1:05:30"), 3930);
});

test("reads a whole number as minutes", () => {
  assert.equal(parseClock("5"), 300);
});

test("rejects text that is not a time", () => {
  for (const bad of ["", "5分", "1:75", "1:5", "a:10", "1:00:75", "-1:00"]) {
    assert.equal(parseClock(bad), null, bad);
  }
});
