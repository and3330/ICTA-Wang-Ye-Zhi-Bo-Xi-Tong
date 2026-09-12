import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { createServer } from "node:http";
import express, { type RequestHandler } from "express";
import { and, eq, inArray } from "drizzle-orm";
import {
  aiCreditLots,
  aiCreditReservations,
  aiResponseArtifacts,
  noCardTrialAiCalls,
  noCardTrials,
  salesScriptDrafts,
  salesScriptJobCheckpoints,
  salesScriptJobs,
  users,
  webinars,
} from "@shared/schema";
import { SALES_SCRIPT_COST_POINTS, salesScriptOutputSchema } from "@shared/salesScript";
import { db } from "./db";
import { runOneSalesScriptJob, setSalesScriptProviderForTests } from "./salesScriptGenerator";
import { registerSalesScriptRoutes } from "./salesScriptRoutes";
import { salesScriptQueueScope, storage } from "./storage";

const validAnswers = {
  planName: "真實課程名稱",
  instructor: "講師的真實可核對背景",
  audience: "需要建立流程的創作者",
  painPoints: "不知道如何穩定完成每週工作",
  modules: "模組一：規劃；模組二：執行；模組三：回顧",
  pricing: "依實際頁面公布的價格與付款方式",
  bonuses: "無贈品",
};
const stageMinutes = [12, 9, 18, 23, 4, 30];
const stageSlides = [13, 5, 6, 5, 3, 10];
const stageContexts = [
  "開場確認此刻的需求與參與動機，請先辨認自己想解決的事情。",
  "區分目前的嘗試和可調整的方向，承認這個方法也有適用限制。",
  "分享轉折故事並建立可查證的信任，沒有證據的成果不要宣稱。",
  "教學時間逐步展示觀察和判斷方式，讓大家練習不同的思考。",
  "進入選擇前再次確認準備程度，了解設計課程的原因和期待。",
  "介紹購買條件並逐項說明商品價值，回答疑問後尊重自主決策。",
];
const distinctFocuses = [
  "觀眾此刻面對的真實困惑", "可核對的講師經驗與限制", "舊方法造成的具體卡關",
  "改變後可以採取的第一步", "今天內容和受眾的關聯", "案例資料缺少時的誠實占位",
  "學習流程中需要的準備", "課程模組帶來的實際幫助", "觀眾可自行檢查的行動",
  "報名之前應核對的條件", "風險與不適合對象的說明", "下一步決策所需的資訊",
  "保持自主選擇的提醒",
];

function completeSection(stage: number) {
  const duration = stageMinutes[stage - 1] / stageSlides[stage - 1];
  const line = "現在請你先回想自己真正遇到的情境，這裡只根據已提供的資料說明可行下一步，沒有資料的地方請在正式演講前補上真實內容並再次確認。";
  return {
    sectionNumber: stage,
    title: `第 ${stage} 段`,
    durationMinutes: stageMinutes[stage - 1],
    slides: Array.from({ length: stageSlides[stage - 1] }, (_, index) => ({
      slideTitle: `第 ${stage} 段投影片 ${index + 1}`,
      purpose: "協助觀眾理解真實資料與下一步，不建立未提供的事實。",
      spokenVerbatim: `${stageContexts[stage - 1].repeat(10)}。${distinctFocuses[index].repeat(12)}。${line.repeat(Math.ceil((duration * 180 + 120) / line.length))}`,
      interaction: "無，繼續講述",
      durationMinutes: duration,
      subdivision: `${stage}-${index + 1}`,
    })),
  };
}

function stageFromPrompt(prompt: string) {
  const match = prompt.match(/只生成第\s+(\d)\s+段/);
  assert.ok(match, "provider receives a stage prompt");
  return Number(match[1]);
}

async function jsonRequest(base: string, path: string, actor: string, init: RequestInit = {}) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", "x-test-user": actor, ...(init.headers || {}) },
  });
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : null };
}

test("sales-script validation rejects cross-section duplication and shifted repeated text", () => {
  const valid = {
    language: "zh-TW",
    totalDurationMinutes: 96,
    sections: Array.from({ length: 6 }, (_, index) => completeSection(index + 1)),
  };
  assert.equal(salesScriptOutputSchema.safeParse(valid).success, true);
  for (const prefix of ["", "新"]) {
    const repeated = structuredClone(valid);
    repeated.sections[5].slides[0].spokenVerbatim =
      prefix + repeated.sections[2].slides[0].spokenVerbatim;
    const result = salesScriptOutputSchema.safeParse(repeated);
    assert.equal(result.success, false);
    if (!result.success) assert.ok(result.error.issues.some((issue) => issue.message.includes("過於相似")));
  }
});

test("sales-script jobs atomically charge, resume safely, and never expose refunded partial output", async (t) => {
  const suffix = crypto.randomUUID();
  const ids = Object.fromEntries([
    "paid", "poor", "concurrent", "enterprise", "trial", "other", "failed", "active", "restart", "late", "expired", "malformed", "short", "truncated",
  ].map((name) => [name, crypto.randomUUID()])) as Record<string, string>;
  const webinarIds = Object.fromEntries(Object.entries(ids).map(([name]) => [name, crypto.randomUUID()])) as Record<string, string>;
  const allUserIds = Object.values(ids);
  const allWebinarIds = Object.values(webinarIds);
  let server: ReturnType<typeof createServer> | undefined;

  t.after(async () => {
    setSalesScriptProviderForTests();
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    const jobs = await db.select({ id: salesScriptJobs.id }).from(salesScriptJobs)
      .where(inArray(salesScriptJobs.webinarId, allWebinarIds));
    if (jobs.length) await db.delete(salesScriptJobCheckpoints)
      .where(inArray(salesScriptJobCheckpoints.jobId, jobs.map((job) => job.id)));
    await db.delete(salesScriptJobs).where(inArray(salesScriptJobs.webinarId, allWebinarIds));
    await db.delete(salesScriptDrafts).where(inArray(salesScriptDrafts.webinarId, allWebinarIds));
    await db.delete(aiResponseArtifacts).where(inArray(aiResponseArtifacts.webinarId, allWebinarIds));
    await db.delete(aiCreditReservations).where(inArray(aiCreditReservations.userId, allUserIds));
    await db.delete(noCardTrialAiCalls).where(inArray(noCardTrialAiCalls.userId, allUserIds));
    await db.delete(noCardTrials).where(inArray(noCardTrials.userId, allUserIds));
    await db.delete(aiCreditLots).where(inArray(aiCreditLots.userId, allUserIds));
    await db.delete(webinars).where(inArray(webinars.id, allWebinarIds));
    await db.delete(users).where(inArray(users.id, allUserIds));
  });

  await db.insert(users).values(Object.entries(ids).map(([name, id]) => ({
    id,
    username: `sales-script-${name}-${suffix}`,
    password: "test-only",
    email: `${name}-${suffix}@example.test`,
    isActive: true,
    subscriptionPlan: name === "enterprise" ? "enterprise" : "free",
    isSuperAdmin: name === "enterprise",
    aiPoints: name === "poor" ? 3599 : 3600,
  })));
  await db.insert(webinars).values(Object.entries(webinarIds).map(([name, id]) => ({
    id,
    userId: ids[name],
    title: `Sales script ${name}`,
    vimeoUrl: "",
    startTime: new Date("2031-01-01T00:00:00.000Z"),
  })));
  await db.insert(aiCreditLots).values(Object.entries(ids)
    .map(([name, userId]) => ({
      userId,
      source: "purchase" as const,
      originalPoints: name === "poor" ? 3599 : 3600,
      remainingPoints: name === "poor" ? 3599 : 3600,
      idempotencyKey: `sales-script-test:${suffix}:${name}`,
    })));
  const trialStartsAt = new Date(Date.now() - 60_000);
  const trialExpiresAt = new Date(trialStartsAt.getTime() + 14 * 24 * 60 * 60_000);
  await db.insert(noCardTrials).values({
    userId: ids.trial,
    startsAt: trialStartsAt,
    expiresAt: trialExpiresAt,
    retentionUntil: new Date(trialExpiresAt.getTime() + 30 * 24 * 60 * 60_000),
  });

  const app = express();
  app.use(express.json());
  const requireTestOwner: RequestHandler = async (req, res, next) => {
    const webinar = await storage.getWebinar(req.params.id as string);
    if (!webinar || webinar.userId !== req.header("x-test-user")) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }
    (req as typeof req & { session: { userId: string } }).session = { userId: webinar.userId };
    next();
  };
  registerSalesScriptRoutes(app, requireTestOwner);
  server = createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const paidPath = `/api/webinars/${webinarIds.paid}/sales-script`;

  // Drafts are owner-private and strict job admission requires every shared
  // required id (including an honest "無贈品").
  let result = await jsonRequest(base, `${paidPath}/draft`, ids.paid, {
    method: "PUT", body: JSON.stringify({ answers: validAnswers }),
  });
  assert.equal(result.response.status, 204);
  result = await jsonRequest(base, `${paidPath}/jobs`, ids.paid, {
    method: "POST",
    body: JSON.stringify({ answers: { ...validAnswers, bonuses: "" }, ackCost: 3600, idempotencyKey: `bad-${suffix}` }),
  });
  assert.equal(result.response.status, 400);
  result = await jsonRequest(base, `${paidPath}/jobs`, ids.other, {
    method: "POST",
    body: JSON.stringify({ answers: validAnswers, ackCost: 3600, idempotencyKey: `forbidden-${suffix}` }),
  });
  assert.equal(result.response.status, 403);

  // Admission + debit occur in the same storage transaction. Duplicate owner
  // submissions return the existing job and cannot consume a second lot.
  const paidKey = `paid-${suffix}`;
  const [first, duplicate] = await Promise.all([
    jsonRequest(base, `${paidPath}/jobs`, ids.paid, {
      method: "POST", body: JSON.stringify({ answers: validAnswers, ackCost: 3600, idempotencyKey: paidKey }),
    }),
    jsonRequest(base, `${paidPath}/jobs`, ids.paid, {
      method: "POST", body: JSON.stringify({ answers: validAnswers, ackCost: 3600, idempotencyKey: paidKey }),
    }),
  ]);
  assert.equal(first.response.status, 202);
  assert.equal(duplicate.response.status, 202);
  assert.equal(first.body.id, duplicate.body.id);
  result = await jsonRequest(base, `/api/webinars/${webinarIds.other}/sales-script/jobs`, ids.other, {
    method: "POST", body: JSON.stringify({ answers: validAnswers, ackCost: 3600, idempotencyKey: paidKey }),
  });
  assert.equal(result.response.status, 202, "the same key owned by another account creates that account's job");
  assert.notEqual(result.body.id, first.body.id);
  result = await jsonRequest(base, `${paidPath}/jobs`, ids.paid, {
    method: "POST",
    body: JSON.stringify({ answers: { ...validAnswers, audience: "不同內容" }, ackCost: 3600, idempotencyKey: paidKey }),
  });
  assert.equal(result.response.status, 409, "an idempotency key cannot be rebound to different answers");
  result = await jsonRequest(base, `${paidPath}/jobs`, ids.paid, {
    method: "POST",
    body: JSON.stringify({ answers: validAnswers, ackCost: 3599, idempotencyKey: paidKey }),
  });
  assert.equal(result.response.status, 409, "a reused key cannot change its acknowledged fixed cost");
  const paidJobId = first.body.id as string;
  assert.equal((await storage.getAiCreditSummary(ids.paid)).points, 0);
  result = await jsonRequest(base, `${paidPath}/jobs/${paidJobId}`, ids.paid);
  assert.equal(result.response.status, 200);
  assert.equal("result" in result.body, false, "queued jobs never expose partial output");

  result = await jsonRequest(base, `/api/webinars/${webinarIds.poor}/sales-script/jobs`, ids.poor, {
    method: "POST", body: JSON.stringify({ answers: validAnswers, ackCost: 3600, idempotencyKey: `poor-${suffix}` }),
  });
  assert.equal(result.response.status, 402, "3599 points cannot buy a 3600-point job");

  const concurrentPath = `/api/webinars/${webinarIds.concurrent}/sales-script/jobs`;
  const [parallelA, parallelB] = await Promise.all([
    jsonRequest(base, concurrentPath, ids.concurrent, {
      method: "POST", body: JSON.stringify({ answers: validAnswers, ackCost: 3600, idempotencyKey: `parallel-a-${suffix}` }),
    }),
    jsonRequest(base, concurrentPath, ids.concurrent, {
      method: "POST", body: JSON.stringify({ answers: validAnswers, ackCost: 3600, idempotencyKey: `parallel-b-${suffix}` }),
    }),
  ]);
  assert.deepEqual([parallelA.response.status, parallelB.response.status].sort(), [202, 402]);

  // Enterprise/admin is intentionally not unlimited for this expensive job.
  result = await jsonRequest(base, `/api/webinars/${webinarIds.enterprise}/sales-script`, ids.enterprise);
  assert.equal(result.body.availablePoints, 3600);
  result = await jsonRequest(base, `/api/webinars/${webinarIds.enterprise}/sales-script/jobs`, ids.enterprise, {
    method: "POST", body: JSON.stringify({ answers: validAnswers, ackCost: 3600, idempotencyKey: `enterprise-${suffix}` }),
  });
  assert.equal(result.response.status, 202);
  assert.equal((await storage.getAiCreditSummary(ids.enterprise)).points, 0);

  // A free/trial account's purchased 3600-point lot works and does not touch
  // its distinct 50-call no-card-trial allowance.
  result = await jsonRequest(base, `/api/webinars/${webinarIds.trial}/sales-script/jobs`, ids.trial, {
    method: "POST", body: JSON.stringify({ answers: validAnswers, ackCost: 3600, idempotencyKey: `trial-paid-${suffix}` }),
  });
  assert.equal(result.response.status, 202);
  const trialCalls = await db.select().from(noCardTrialAiCalls).where(eq(noCardTrialAiCalls.userId, ids.trial));
  assert.equal(trialCalls.length, 0);

  // Process all currently admitted valid jobs with a local provider stub.
  let fullSkillWasPassed = false;
  setSalesScriptProviderForTests(async ({ prompt, systemPrompt }) => {
    assert.match(systemPrompt, /六大段落/);
    assert.match(systemPrompt, /每個增強器後重複報名方式/);
    fullSkillWasPassed = true;
    return JSON.stringify(completeSection(stageFromPrompt(prompt)));
  });
  const fixtureOutput = salesScriptOutputSchema.safeParse({
    language: "zh-TW", totalDurationMinutes: 96, sections: [1, 2, 3, 4, 5, 6].map(completeSection),
  });
  assert.equal(fixtureOutput.success, true, fixtureOutput.success ? "" : fixtureOutput.error.issues[0]?.message);
  for (let count = 0; count < 8; count += 1) {
    if (!await runOneSalesScriptJob()) break;
  }
  assert.equal(fullSkillWasPassed, true);
  result = await jsonRequest(base, `${paidPath}/jobs/${paidJobId}`, ids.paid);
  const paidCheckpoints = await db.select().from(salesScriptJobCheckpoints)
    .where(eq(salesScriptJobCheckpoints.jobId, paidJobId));
  assert.equal(result.body.status, "completed", `${result.body.errorMessage}; checkpoints=${paidCheckpoints.length}`);
  assert.equal(result.body.result.sections.length, 6);
  const [paidReservation] = await db.select().from(aiCreditReservations).where(eq(aiCreditReservations.id,
    (await storage.getSalesScriptJob(ids.paid, webinarIds.paid, paidJobId))!.reservationId));
  assert.equal(paidReservation.status, "consumed");
  const [artifact] = await db.select().from(aiResponseArtifacts).where(eq(aiResponseArtifacts.reservationId, paidReservation.id));
  assert.ok(artifact?.responseText.includes("\"sections\""));

  // Failed malformed and too-short/truncated output refunds exactly once and
  // GET continues to withhold checkpoints/result after that refund.
  for (const name of ["failed", "malformed", "short", "truncated"] as const) {
    const admitted = await storage.admitSalesScriptJob({
      ownerId: ids[name], webinarId: webinarIds[name], idempotencyKey: `${name}-${suffix}`,
      answers: validAnswers, points: SALES_SCRIPT_COST_POINTS,
    });
    assert.ok(admitted);
    setSalesScriptProviderForTests(async ({ prompt }) => name === "short"
      ? JSON.stringify({ ...completeSection(stageFromPrompt(prompt)), slides: [completeSection(stageFromPrompt(prompt)).slides[0]] })
      : "{\"sectionNumber\":1");
    assert.equal(await runOneSalesScriptJob(), true);
    const job = await storage.getSalesScriptJob(ids[name], webinarIds[name], admitted.job.id);
    assert.equal(job?.status, "failed");
    assert.equal(job?.result, null);
    const [reservation] = await db.select().from(aiCreditReservations).where(eq(aiCreditReservations.id, admitted.job.reservationId));
    assert.equal(reservation.status, "refunded");
    assert.equal((await storage.getAiCreditSummary(ids[name])).points, 3600);
    const read = await jsonRequest(base, `/api/webinars/${webinarIds[name]}/sales-script/jobs/${admitted.job.id}`, ids[name]);
    assert.equal("result" in read.body, false);
    assert.equal(await storage.failSalesScriptJob({
      jobId: admitted.job.id, ownerId: ids[name], reservationId: admitted.job.reservationId, message: "repeat",
    }), true, "a repeat failure cannot refund twice");
  }

  // Legacy 15-minute reconciliation must fence a durable active job.
  const active = await storage.admitSalesScriptJob({
    ownerId: ids.active, webinarId: webinarIds.active, idempotencyKey: `active-${suffix}`,
    answers: validAnswers, points: SALES_SCRIPT_COST_POINTS,
  });
  assert.ok(active);
  const old = new Date(Date.now() - 16 * 60_000);
  await db.update(aiCreditReservations).set({ createdAt: old }).where(eq(aiCreditReservations.id, active.job.reservationId));
  await db.update(salesScriptJobs).set({ createdAt: old }).where(eq(salesScriptJobs.id, active.job.id));
  assert.equal((await storage.reserveAiCredits(ids.active, 1)), null, "active job remains charged rather than silently refunded");
  const [activeReservation] = await db.select().from(aiCreditReservations).where(eq(aiCreditReservations.id, active.job.reservationId));
  assert.equal(activeReservation.status, "reserved");
  await storage.failSalesScriptJob({ jobId: active.job.id, ownerId: ids.active, reservationId: active.job.reservationId, message: "cleanup" });

  // A recovered lease keeps stage 1, resumes at stage 2, and a late old worker
  // cannot refund a reservation currently held by the replacement lease.
  const restart = await storage.admitSalesScriptJob({
    ownerId: ids.restart, webinarId: webinarIds.restart, idempotencyKey: `restart-${suffix}`,
    answers: validAnswers, points: SALES_SCRIPT_COST_POINTS,
  });
  assert.ok(restart);
  const oldLease = "old-lease";
  const oldClaim = await storage.claimNextSalesScriptJob(oldLease, new Date(Date.now() + 60_000));
  assert.equal(oldClaim?.id, restart.job.id);
  assert.equal(await storage.saveSalesScriptCheckpoint({
    jobId: restart.job.id, leaseToken: oldLease, stage: 1, section: completeSection(1),
  }), true);
  await db.update(salesScriptJobs).set({ leaseExpiresAt: new Date(Date.now() - 1_000) })
    .where(eq(salesScriptJobs.id, restart.job.id));
  const observedStages: number[] = [];
  setSalesScriptProviderForTests(async ({ prompt }) => {
    const stage = stageFromPrompt(prompt);
    observedStages.push(stage);
    return JSON.stringify(completeSection(stage));
  });
  const replacementLease = "replacement-lease";
  const replacement = await storage.claimNextSalesScriptJob(replacementLease, new Date(Date.now() + 60_000));
  assert.equal(replacement?.id, restart.job.id);
  assert.equal(await storage.failSalesScriptJob({
    jobId: restart.job.id, ownerId: ids.restart, reservationId: restart.job.reservationId, leaseToken: oldLease, message: "late worker",
  }), false);
  await db.update(salesScriptJobs).set({ leaseExpiresAt: new Date(Date.now() - 1_000) })
    .where(eq(salesScriptJobs.id, restart.job.id));
  assert.equal(await runOneSalesScriptJob(), true);
  assert.deepEqual(observedStages, [2, 3, 4, 5, 6]);
  assert.equal((await storage.getSalesScriptJob(ids.restart, webinarIds.restart, restart.job.id))?.status, "completed");

  const expired = await storage.admitSalesScriptJob({
    ownerId: ids.expired, webinarId: webinarIds.expired, idempotencyKey: `expired-${suffix}`,
    answers: validAnswers, points: SALES_SCRIPT_COST_POINTS,
  });
  assert.ok(expired);
  await db.update(salesScriptJobs).set({ createdAt: new Date(Date.now() - 46 * 60_000) })
    .where(eq(salesScriptJobs.id, expired.job.id));
  assert.equal(await runOneSalesScriptJob(), true);
  assert.equal((await storage.getSalesScriptJob(ids.expired, webinarIds.expired, expired.job.id))?.status, "failed");
  const [expiredReservation] = await db.select().from(aiCreditReservations).where(eq(aiCreditReservations.id, expired.job.reservationId));
  assert.equal(expiredReservation.status, "refunded");

  // Use another test scope, never app: a running development worker must
  // not be able to claim this fixture even during this brief assertion.
  const scopeFence = await storage.admitSalesScriptJob({
    ownerId: ids.active, webinarId: webinarIds.active, idempotencyKey: `scope-${suffix}`,
    answers: validAnswers, points: SALES_SCRIPT_COST_POINTS,
  });
  assert.ok(scopeFence);
  await db.update(salesScriptJobs).set({ queueScope: `test-other-${suffix}` })
    .where(eq(salesScriptJobs.id, scopeFence.job.id));
  assert.equal(await runOneSalesScriptJob(), false, "test worker must not claim another queue's work");
  await db.update(salesScriptJobs).set({ queueScope: salesScriptQueueScope })
    .where(eq(salesScriptJobs.id, scopeFence.job.id));
  assert.equal(await runOneSalesScriptJob(), true);
});