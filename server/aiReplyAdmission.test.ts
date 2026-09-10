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
  const webinarController = new AiReplyAdmissionController();
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

  const ownerController = new AiReplyAdmissionController();
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