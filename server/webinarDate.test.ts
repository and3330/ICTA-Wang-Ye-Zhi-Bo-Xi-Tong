import assert from "node:assert/strict";
import test from "node:test";
import { applyDatePreservingTime, dateKeyInTimeZone } from "../client/src/lib/webinar-date";

test("event date editing preserves a non-midnight Taipei start time", () => {
  const original = "2026-09-09T11:00:00.000Z";
  assert.equal(dateKeyInTimeZone(original, "Asia/Taipei"), "2026-09-09");
  assert.equal(applyDatePreservingTime(original, "2026-09-09", "Asia/Taipei"), original);
  assert.equal(
    applyDatePreservingTime(original, "2026-09-10", "Asia/Taipei"),
    "2026-09-10T11:00:00.000Z",
  );
});