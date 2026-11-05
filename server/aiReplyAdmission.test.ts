import assert from "node:assert/strict";
import test from "node:test";
import {
  AiReplyAdmissionController,
  executeAdmittedAiReply,
  type AiReplyAdmissionInput,
  validateViewerChatContent,
} from "./aiReplyAdmission";

function input(overrides: Partial<AiReplyAdmissionInput> = {}): AiReplyAdmissionInput {
  return {
    ownerId: "owner-a",
    webinarId: "webinar-a",
    viewerId: "registration-a",
    question: "問題一？",
    now: 1_000,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

test("viewer chat validation trims accepted text and rejects invalid or oversized frames", () => {
  assert.deepEqual(validateViewerChatContent("  正常問題？  "), { ok: true, value: "正常問題？" });
  assert.equal(validateViewerChatContent(null).ok, false);
  assert.equal(validateViewerChatContent("   ").ok, false);
  assert.equal(validateViewerChatContent("問".repeat(2_001)).ok, false);
});

test("admission rejects excess viewer frames before reservation/provider work", async () => {
  const controller = new AiReplyAdmissionController();
  const pending = deferred<string>();
  let reservations = 0;
  let providerCalls = 0;
  const work = async () => {
    reservations += 1;
    providerCalls += 1;
    return pending.promise;
  };

  const first = executeAdmittedAiReply(controller, input(), work);
  const second = await executeAdmittedAiReply(
    controller,
    input({ question: "不同問題二？", now: 1_001 }),
    work,
  );
  assert.equal(second.accepted, false);
  if (!second.accepted) assert.equal(second.reason, "viewer_busy");
  assert.equal(reservations, 1);
  assert.equal(providerCalls, 1);

  pending.resolve("ok");
  assert.equal((await first).accepted, true);
  const duplicate = await executeAdmittedAiReply(
    controller,
    input({ now: 1_002 }),
    work,
  );
  assert.equal(duplicate.accepted, false);
  if (!duplicate.accepted) assert.equal(duplicate.reason, "duplicate");
  assert.equal(reservations, 1);
  assert.equal(providerCalls, 1);
});

test("rolling session rate rejects the seventh accepted attempt without work", async () => {
  const controller = new AiReplyAdmissionController();
  let workCalls = 0;
  for (let index = 0; index < 6; index += 1) {
    const result = await executeAdmittedAiReply(
      controller,
      input({ question: `不同問題 ${index}？`, now: 2_000 + index }),
      async () => { workCalls += 1; },
    );
    assert.equal(result.accepted, true);
  }
  const rejected = await executeAdmittedAiReply(
    controller,
    input({ question: "第七個不同問題？", now: 2_010 }),
    async () => { workCalls += 1; },
  );
  assert.equal(rejected.accepted, false);
  if (!rejected.accepted) assert.equal(rejected.reason, "session_rate");
  assert.equal(workCalls, 6);
});

test("webinar and owner concurrency caps apply to paid and unlimited work alike", async () => {
  const webinarController = new AiReplyAdmissionController({ webinar: 3, owner: 6 });
  const webinarPending = deferred<void>();
  let webinarWork = 0;
  const webinarJobs = Array.from({ length: 3 }, (_, index) =>
    executeAdmittedAiReply(
      webinarController,
      input({ viewerId: `viewer-${index}`, question: `問題 ${index}？` }),
      async () => { webinarWork += 1; await webinarPending.promise; },
    ));
  const fourth = await executeAdmittedAiReply(
    webinarController,
    input({ viewerId: "viewer-4", question: "第四題？" }),
    async () => { webinarWork += 1; },
  );
  assert.equal(fourth.accepted, false);
  if (!fourth.accepted) assert.equal(fourth.reason, "webinar_busy");
  assert.equal(webinarWork, 3);
  webinarPending.resolve();
  await Promise.all(webinarJobs);

  const ownerController = new AiReplyAdmissionController({ webinar: 3, owner: 6 });
  const ownerPending = deferred<void>();
  let ownerWork = 0;
  const ownerJobs = Array.from({ length: 6 }, (_, index) =>
    executeAdmittedAiReply(
      ownerController,
      input({
        webinarId: index < 3 ? "webinar-a" : "webinar-b",
        viewerId: `enterprise-viewer-${index}`,
        question: `企業問題 ${index}？`,
      }),
      async () => { ownerWork += 1; await ownerPending.promise; },
    ));
  const seventh = await executeAdmittedAiReply(
    ownerController,
    input({ webinarId: "webinar-c", viewerId: "enterprise-viewer-7", question: "企業第七題？" }),
    async () => { ownerWork += 1; },
  );
  assert.equal(seventh.accepted, false);
  if (!seventh.accepted) assert.equal(seventh.reason, "owner_busy");
  assert.equal(ownerWork, 6);
  ownerPending.resolve();
  await Promise.all(ownerJobs);
});
test("a full room queues the next question instead of refusing it", async () => {
  const controller = new AiReplyAdmissionController({ webinar: 1, owner: 10 });
  const first = deferred<void>();
  const order: string[] = [];
  const running = executeAdmittedAiReply(
    controller,
    input({ viewerId: "viewer-1", question: "第一題？", now: undefined }),
    async () => { order.push("first"); await first.promise; },
  );
  let queued = false;
  const waiting = executeAdmittedAiReply(
    controller,
    input({ viewerId: "viewer-2", question: "第二題？", now: undefined }),
    async () => { order.push("second"); return "answered"; },
    { queueMs: 5_000, onQueued: () => { queued = true; } },
  );
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(queued, true);
  // The waiting viewer asking again is told the first question is still being handled.
  const again = await executeAdmittedAiReply(
    controller,
    input({ viewerId: "viewer-2", question: "另一題？", now: undefined }),
    async () => "never",
    { queueMs: 5_000 },
  );
  assert.equal(again.accepted, false);
  if (!again.accepted) assert.equal(again.reason, "viewer_busy");
  first.resolve();
  await running;
  const result = await waiting;
  assert.equal(result.accepted, true);
  if (result.accepted) assert.equal(result.value, "answered");
  assert.deepEqual(order, ["first", "second"]);
});

test("a queued question gives up after the wait limit", async () => {
  const controller = new AiReplyAdmissionController({ webinar: 1, owner: 10 });
  const hold = deferred<void>();
  const running = executeAdmittedAiReply(controller, input({ viewerId: "v1", now: undefined }), () => hold.promise);
  const late = await executeAdmittedAiReply(
    controller,
    input({ viewerId: "v2", question: "等不到？", now: undefined }),
    async () => "never",
    { queueMs: 300 },
  );
  assert.equal(late.accepted, false);
  if (!late.accepted) assert.equal(late.reason, "webinar_busy");
  hold.resolve();
  await running;
});
