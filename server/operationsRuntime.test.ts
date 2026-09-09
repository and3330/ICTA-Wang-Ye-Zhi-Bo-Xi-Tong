import assert from "node:assert/strict";
import test from "node:test";
import {
  beginShutdown,
  drainOperations,
  inFlightOperationCount,
  isAcceptingWork,
  schedulerFailure,
  schedulerMetrics,
  schedulerSuccess,
  trackOperation,
} from "./operationsRuntime";

test("tracked operations drain before the bounded deadline", async () => {
  let release!: () => void;
  const work = new Promise<void>((resolve) => { release = resolve; });
  trackOperation(work);
  assert.equal(inFlightOperationCount(), 1);
  setTimeout(release, 5);
  assert.equal(await drainOperations(100), true);
  assert.equal(inFlightOperationCount(), 0);
});

test("shutdown atomically stops new work and scheduler metrics contain no job data", () => {
  schedulerFailure("email_delivery");
  schedulerSuccess("email_delivery");
  assert.deepEqual(Object.keys(schedulerMetrics()), ["email_delivery"]);
  assert.equal((schedulerMetrics() as any).email_delivery.consecutiveFailures, 0);
  assert.equal(isAcceptingWork(), true);
  assert.equal(beginShutdown(), true);
  assert.equal(beginShutdown(), false);
  assert.equal(isAcceptingWork(), false);
});