import test from "node:test";
import assert from "node:assert/strict";
import { pickResumePosition } from "./resume-position";

test("resumes from the furthest saved position", () => {
  assert.equal(pickResumePosition({ local: 312, server: 290, duration: 3600 }), 312);
  assert.equal(pickResumePosition({ local: null, server: 1200, duration: 3600 }), 1200);
  assert.equal(pickResumePosition({ local: 845.7, duration: 0 }), 845);
});

test("starts from the beginning when there is nothing useful to resume", () => {
  assert.equal(pickResumePosition({}), 0);
  assert.equal(pickResumePosition({ local: 3, server: 0, duration: 3600 }), 0);
  assert.equal(pickResumePosition({ local: Number.NaN, server: -1 }), 0);
});

test("a finished video starts over", () => {
  assert.equal(pickResumePosition({ local: 3598, duration: 3600 }), 0);
  assert.equal(pickResumePosition({ server: 3600, duration: 3600 }), 0);
});
