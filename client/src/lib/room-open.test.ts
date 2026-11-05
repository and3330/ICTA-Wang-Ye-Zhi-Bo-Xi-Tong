import test from "node:test";
import assert from "node:assert/strict";
import { isRoomOpenSoon } from "./room-open";

const start = "2026-11-06T12:00:00.000Z";
const at = (iso: string) => new Date(iso).getTime();

test("the room opens 30 minutes before the start", () => {
  assert.equal(isRoomOpenSoon(start, false, at("2026-11-06T10:00:00Z")), false);
  assert.equal(isRoomOpenSoon(start, false, at("2026-11-06T11:29:00Z")), false);
  assert.equal(isRoomOpenSoon(start, false, at("2026-11-06T11:30:00Z")), true);
  assert.equal(isRoomOpenSoon(start, false, at("2026-11-06T13:00:00Z")), true);
});

test("on-demand and unknown start times always show the button", () => {
  assert.equal(isRoomOpenSoon(start, true, at("2026-11-01T00:00:00Z")), true);
  assert.equal(isRoomOpenSoon(null, false), true);
  assert.equal(isRoomOpenSoon("not a date", false), true);
});
