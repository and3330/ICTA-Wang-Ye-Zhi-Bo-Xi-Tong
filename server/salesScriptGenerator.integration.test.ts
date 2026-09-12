import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { createServer } from "node:http";
import express, { type RequestHandler } from "express";
import { eq, inArray } from "drizzle-orm";
import {
  aiCreditLots, aiCreditReservations, aiPointTransactions, aiResponseArtifacts, salesScriptDrafts,
  salesScriptJobCheckpoints, salesScriptJobs, salesScriptPurchases, users, webinars,
} from "@shared/schema";
import { SALES_SCRIPT_COST_POINTS, salesScriptOutputSchema } from "@shared/salesScript";
import { db } from "./db";
import { runOneSalesScriptJob, setSalesScriptProviderForTests } from "./salesScriptGenerator";
import { registerSalesScriptRoutes } from "./salesScriptRoutes";
import { salesScriptQueueScope, storage } from "./storage";

const basicAnswers = {
  planName: "真實課程名稱", audience: "需要建立流程的創作者",
  painPoints: "不知道如何穩定完成每週工作", modules: "模組一：規劃；模組二：執行；模組三：回顧",
  pricing: "依實際頁面公布的價格與付款方式",
};
const fullAnswers = { ...basicAnswers, instructor: "講師的真實可核對背景", bonuses: "無贈品" };
const slides = [13, 5, 6, 5, 3, 10];
const minutes = [12, 9, 18, 23, 4, 30];
const stageContexts = [
  "開場確認此刻的需求與參與動機，請先辨認自己想解決的事情。",
  "區分目前的嘗試和可調整的方向，承認這個方法也有適用限制。",
  "分享轉折故事並建立可查證的信任，沒有證據的成果不要宣稱。",
  "教學時間逐步展示觀察和判斷方式，讓大家練習不同的思考。",
  "進入選擇前再次確認準備程度，了解設計課程的原因和期待。",
  "介紹購買條件並逐項說明商品價值，回答疑問後尊重自主決策。",
];
const focuses = [
  "觀眾此刻面對的真實困惑", "可核對的講師經驗與限制", "舊方法造成的具體卡關",
  "改變後可以採取的第一步", "今天內容和受眾的關聯", "案例資料缺少時的誠實占位",
  "學習流程中需要的準備", "課程模組帶來的實際幫助", "觀眾可自行檢查的行動",
  "報名之前應核對的條件", "風險與不適合對象的說明", "下一步決策所需的資訊", "保持自主選擇的提醒",
];

function completeSection(stage: number) {
  const duration = minutes[stage - 1] / slides[stage - 1];
  const line = "這段內容只根據使用者已確認的真實資料安排，沒有提供證據的地方會明確提醒觀眾自行核對條件與限制，並尊重每一位觀眾是否適合參加的自主決定。";
  return {
    sectionNumber: stage, title: `第 ${stage} 段`, durationMinutes: minutes[stage - 1],
    slides: Array.from({ length: slides[stage - 1] }, (_, index) => ({
      slideTitle: `第 ${stage} 段投影片 ${index + 1}`, purpose: "協助觀眾理解真實資料、限制與下一步。",
      spokenVerbatim: `${stageContexts[stage - 1].repeat(10)}。${focuses[index].repeat(12)}。${line.repeat(Math.ceil((duration * 180 + 120) / line.length))}`,
      interaction: "無，繼續講述", durationMinutes: duration, subdivision: `${stage}-${index + 1}`,
    })),
  };
}
function stageFromPrompt(prompt: string) {
  const match = prompt.match(/只生成第\s+(\d)\s+段/);
  assert.ok(match);
  return Number(match[1]);
}
async function request(base: string, path: string, actor: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", "x-test-user": actor },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : null };
}

test("sales-script output rejects shifted or cross-section repeated content", () => {
  const valid = {
    language: "zh-TW" as const, totalDurationMinutes: 96,
    sections: Array.from({ length: 6 }, (_, index) => completeSection(index + 1)),
  };
  assert.equal(salesScriptOutputSchema.safeParse(valid).success, true);
  const repeated = structuredClone(valid);
  repeated.sections[5].slides[0].spokenVerbatim = repeated.sections[2].slides[0].spokenVerbatim;
  const validation = salesScriptOutputSchema.safeParse(repeated);
  assert.equal(validation.success, false);
  if (!validation.success) assert.ok(validation.error.issues.some((issue) => issue.message.includes("過於相似")));
});

test("purchase-before-questionnaire reserves once, gates data, and consumes/refunds one protected reservation", async (t) => {
  const suffix = crypto.randomUUID();
  const names = ["paid", "poor", "failed", "legacy", "other"] as const;
  const owner = Object.fromEntries(names.map((name) => [name, crypto.randomUUID()])) as Record<typeof names[number], string>;
  const webinar = Object.fromEntries(names.map((name) => [name, crypto.randomUUID()])) as Record<typeof names[number], string>;
  let server: ReturnType<typeof createServer> | undefined;
  t.after(async () => {
    setSalesScriptProviderForTests();
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    const jobs = await db.select({ id: salesScriptJobs.id }).from(salesScriptJobs).where(inArray(salesScriptJobs.webinarId, Object.values(webinar)));
    if (jobs.length) await db.delete(salesScriptJobCheckpoints).where(inArray(salesScriptJobCheckpoints.jobId, jobs.map((job) => job.id)));
    await db.delete(salesScriptJobs).where(inArray(salesScriptJobs.webinarId, Object.values(webinar)));
    await db.delete(salesScriptPurchases).where(inArray(salesScriptPurchases.webinarId, Object.values(webinar)));
    await db.delete(salesScriptDrafts).where(inArray(salesScriptDrafts.webinarId, Object.values(webinar)));
    await db.delete(aiResponseArtifacts).where(inArray(aiResponseArtifacts.webinarId, Object.values(webinar)));
    await db.delete(aiPointTransactions).where(inArray(aiPointTransactions.userId, Object.values(owner)));
    await db.delete(aiCreditReservations).where(inArray(aiCreditReservations.userId, Object.values(owner)));
    await db.delete(aiCreditLots).where(inArray(aiCreditLots.userId, Object.values(owner)));
    await db.delete(webinars).where(inArray(webinars.id, Object.values(webinar)));
    await db.delete(users).where(inArray(users.id, Object.values(owner)));
  });
  await db.insert(users).values(names.map((name) => ({
    id: owner[name], username: `script-purchase-${name}-${suffix}`, password: "test-only",
    email: `${name}-${suffix}@example.test`, aiPoints: name === "poor" ? 3599 : 3600,
  })));
  await db.insert(webinars).values(names.map((name) => ({
    id: webinar[name], userId: owner[name], title: `purchase ${name}`, vimeoUrl: "",
    startTime: new Date("2031-01-01T00:00:00.000Z"),
  })));
  await db.insert(aiCreditLots).values(names.map((name) => ({
    userId: owner[name], source: "purchase", originalPoints: name === "poor" ? 3599 : 3600,
    remainingPoints: name === "poor" ? 3599 : 3600, idempotencyKey: `purchase-script:${suffix}:${name}`,
  })));
  // Simulate an old pre-gate confidential draft. Its advanced answer must be
  // retained but not sent before payment.
  await storage.saveSalesScriptDraft({ ownerId: owner.paid, webinarId: webinar.paid, answers: { ...basicAnswers, instructor: "舊的保密講師資料" } });
  const app = express();
  app.use(express.json());
  const requireTestOwner: RequestHandler = async (req, res, next) => {
    const item = await storage.getWebinar(req.params.id as string);
    const actor = req.header("x-test-user");
    if (!item || item.userId !== actor) return void res.status(403).json({ message: "Forbidden" });
    (req as typeof req & { session: { userId: string } }).session = { userId: actor! };
    next();
  };
  registerSalesScriptRoutes(app, requireTestOwner);
  server = createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const path = `/api/webinars/${webinar.paid}/sales-script`;

  let result = await request(base, path, owner.paid);
  assert.equal(result.body.hasPurchasedAccess, false);
  assert.equal(result.body.draft.answers.instructor, undefined, "unpaid state redacts old confidential answers");
  const rejectedDraft = await fetch(`${base}${path}/draft`, {
    method: "PUT", headers: { "Content-Type": "application/json", "x-test-user": owner.paid },
    body: JSON.stringify({ answers: { instructor: "直接繞過付款" } }),
  });
  assert.equal(rejectedDraft.status, 402, "unpaid direct confidential draft writes are denied");
  const basicDraft = await fetch(`${base}${path}/draft`, {
    method: "PUT", headers: { "Content-Type": "application/json", "x-test-user": owner.paid },
    body: JSON.stringify({ answers: { planName: basicAnswers.planName } }),
  });
  assert.equal(basicDraft.status, 204);
  result = await request(base, `${path}/questionnaire`, owner.paid);
  assert.equal(result.response.status, 402);
  result = await request(base, `${path}/jobs`, owner.paid, { purchaseId: crypto.randomUUID(), answers: fullAnswers, idempotencyKey: `skip-${suffix}` });
  assert.equal(result.response.status, 402, "a client cannot skip purchase");

  const poorPath = `/api/webinars/${webinar.poor}/sales-script/purchase`;
  result = await request(base, poorPath, owner.poor, { answers: basicAnswers, ackCost: 3600, idempotencyKey: `poor-${suffix}` });
  assert.equal(result.response.status, 402, "3599 cannot reserve 3600");
  const buyKey = `buy-${suffix}`;
  const [firstBuy, duplicateBuy] = await Promise.all([
    request(base, `${path}/purchase`, owner.paid, { answers: basicAnswers, ackCost: 3600, idempotencyKey: buyKey }),
    request(base, `${path}/purchase`, owner.paid, { answers: basicAnswers, ackCost: 3600, idempotencyKey: buyKey }),
  ]);
  assert.equal(firstBuy.response.status, 202);
  assert.equal(duplicateBuy.response.status, 202);
  assert.equal(firstBuy.body.purchase.id, duplicateBuy.body.purchase.id);
  const purchaseId = firstBuy.body.purchase.id as string;
  assert.equal((await storage.getAiCreditSummary(owner.paid)).points, 0);
  result = await request(base, `${path}/purchase`, owner.paid, { answers: { ...basicAnswers, audience: "改變" }, ackCost: 3600, idempotencyKey: buyKey });
  assert.equal(result.response.status, 409, "same purchase key cannot change basic snapshot");
  const editedBasics = { ...basicAnswers, audience: "已購買後更新的目標受眾" };
  result = await request(base, `${path}/purchase`, owner.paid, { answers: editedBasics, ackCost: 3600, idempotencyKey: `other-key-${suffix}` });
  assert.equal(result.response.status, 202, "another click reuses the one active purchase");
  assert.equal(result.body.purchase.id, purchaseId);
  const [purchase] = await db.select().from(salesScriptPurchases).where(eq(salesScriptPurchases.id, purchaseId));
  await db.update(aiCreditReservations).set({ createdAt: new Date(Date.now() - 16 * 60_000) })
    .where(eq(aiCreditReservations.id, purchase.reservationId));
  assert.equal(await storage.reserveAiCredits(owner.paid, 1), null, "long form completion cannot be stale-refunded");
  result = await request(base, `${path}/questionnaire`, owner.paid);
  assert.equal(result.response.status, 200);
  assert.ok(result.body.groups.some((group: { fields: Array<{ id: string }> }) => group.fields.some((field) => field.id === "pricing")));
  result = await request(base, path, owner.paid);
  assert.equal(result.body.draft.answers.instructor, "舊的保密講師資料", "payment reveals preserved old answer");
  const editedFullAnswers = { ...fullAnswers, ...editedBasics };
  const paidEditedDraft = await fetch(`${base}${path}/draft`, {
    method: "PUT", headers: { "Content-Type": "application/json", "x-test-user": owner.paid },
    body: JSON.stringify({ answers: editedFullAnswers }),
  });
  assert.equal(paidEditedDraft.status, 204);
  assert.equal((await storage.getAiCreditSummary(owner.paid)).points, 0,
    "edited paid answers still use the original reservation, not another debit");

  const [jobA, jobB] = await Promise.all([
    request(base, `${path}/jobs`, owner.paid, { purchaseId, answers: editedFullAnswers, idempotencyKey: `job-a-${suffix}` }),
    request(base, `${path}/jobs`, owner.paid, { purchaseId, answers: editedFullAnswers, idempotencyKey: `job-b-${suffix}` }),
  ]);
  assert.equal(jobA.response.status, 202);
  assert.equal(jobB.response.status, 202);
  assert.equal(jobA.body.id, jobB.body.id, "one purchase can attach to only one job");
  result = await request(base, `${path}/jobs`, owner.paid, {
    purchaseId, answers: { ...editedFullAnswers, instructor: "different body" }, idempotencyKey: `job-a-${suffix}`,
  });
  assert.equal(result.response.status, 409, "job idempotency keys cannot be rebound to changed full answers");
  let fullSkillWasPassed = false;
  setSalesScriptProviderForTests(async ({ prompt, systemPrompt }) => {
    assert.match(systemPrompt, /六大段落/);
    fullSkillWasPassed = true;
    return JSON.stringify(completeSection(stageFromPrompt(prompt)));
  });
  assert.equal(await runOneSalesScriptJob(), true);
  assert.equal(fullSkillWasPassed, true);
  const completed = await storage.getSalesScriptJob(owner.paid, webinar.paid, jobA.body.id);
  assert.equal(completed?.status, "completed");
  assert.equal((await db.select().from(aiCreditReservations).where(eq(aiCreditReservations.id, purchase.reservationId)))[0]?.status, "consumed");
  result = await request(base, path, owner.paid);
  assert.equal(result.body.hasPurchasedAccess, true, "completed paid history retains downloads/questions access");
  assert.equal(result.body.canGenerate, false, "historical access is not a free regeneration");
  await storage.grantAiCredits({
    userId: owner.paid, points: 3600, source: "admin_grant", idempotencyKey: `repeat-credit-${suffix}`,
  });
  const repeatBuy = await request(base, `${path}/purchase`, owner.paid, {
    answers: basicAnswers, ackCost: 3600, idempotencyKey: `repeat-buy-${suffix}`,
  });
  assert.equal(repeatBuy.response.status, 202);
  assert.notEqual(repeatBuy.body.purchase.id, purchaseId, "a regeneration requires a newly paid reservation");

  const failedPath = `/api/webinars/${webinar.failed}/sales-script`;
  const failureBuy = await request(base, `${failedPath}/purchase`, owner.failed, { answers: basicAnswers, ackCost: 3600, idempotencyKey: `failure-buy-${suffix}` });
  const failurePurchaseId = failureBuy.body.purchase.id as string;
  const failureJob = await request(base, `${failedPath}/jobs`, owner.failed, { purchaseId: failurePurchaseId, answers: fullAnswers, idempotencyKey: `failure-job-${suffix}` });
  setSalesScriptProviderForTests(async () => "{not json");
  assert.equal(await runOneSalesScriptJob(), true);
  const failed = await storage.getSalesScriptJob(owner.failed, webinar.failed, failureJob.body.id);
  assert.equal(failed?.status, "failed");
  const [failedPurchase] = await db.select().from(salesScriptPurchases).where(eq(salesScriptPurchases.id, failurePurchaseId));
  assert.equal(failedPurchase.status, "refunded");
  assert.equal((await storage.getAiCreditSummary(owner.failed)).points, 3600, "failure refunds exactly once");
  await storage.failSalesScriptJob({ jobId: failed!.id, ownerId: owner.failed, reservationId: failed!.reservationId, message: "retry" });
  assert.equal((await storage.getAiCreditSummary(owner.failed)).points, 3600);
  result = await request(base, `${failedPath}/questionnaire`, owner.failed);
  assert.equal(result.response.status, 402, "failed/refunded-only owner loses confidential access");

  // Legacy jobs had no purchase_id but were already charged at creation.
  const legacy = await storage.admitSalesScriptJob({
    ownerId: owner.legacy, webinarId: webinar.legacy, idempotencyKey: `legacy-${suffix}`, answers: fullAnswers, points: SALES_SCRIPT_COST_POINTS,
  });
  assert.ok(legacy);
  result = await request(base, `/api/webinars/${webinar.legacy}/sales-script/questionnaire`, owner.legacy);
  assert.equal(result.response.status, 200, "legacy ongoing charged work remains accessible");
  setSalesScriptProviderForTests(async ({ prompt }) => JSON.stringify(completeSection(stageFromPrompt(prompt))));
  assert.equal(await runOneSalesScriptJob(), true);
  assert.equal(salesScriptOutputSchema.safeParse((await storage.getSalesScriptJob(owner.legacy, webinar.legacy, legacy.job.id))?.result).success, true);

  // A recovered lease retains a checkpoint, resumes at the following stage,
  // and a late worker cannot refund the replacement worker reservation.
  const resumedPurchase = await storage.purchaseSalesScript({
    ownerId: owner.failed, webinarId: webinar.failed, idempotencyKey: `resume-buy-${suffix}`, basicAnswers, points: SALES_SCRIPT_COST_POINTS,
  });
  assert.ok(resumedPurchase);
  const resumed = await storage.attachSalesScriptPurchaseToJob({
    ownerId: owner.failed, webinarId: webinar.failed, purchaseId: resumedPurchase.purchase.id,
    idempotencyKey: `resume-job-${suffix}`, answers: fullAnswers,
  });
  assert.ok(resumed);
  const oldLease = "old-lease";
  const oldClaim = await storage.claimNextSalesScriptJob(oldLease, new Date(Date.now() + 60_000));
  assert.equal(oldClaim?.id, resumed.job.id);
  assert.equal(await storage.saveSalesScriptCheckpoint({
    jobId: resumed.job.id, leaseToken: oldLease, stage: 1, section: completeSection(1),
  }), true);
  await db.update(salesScriptJobs).set({ leaseExpiresAt: new Date(Date.now() - 1_000) })
    .where(eq(salesScriptJobs.id, resumed.job.id));
  const replacementLease = "replacement-lease";
  const replacement = await storage.claimNextSalesScriptJob(replacementLease, new Date(Date.now() + 60_000));
  assert.equal(replacement?.id, resumed.job.id);
  assert.equal(await storage.failSalesScriptJob({
    jobId: resumed.job.id, ownerId: owner.failed, reservationId: resumed.job.reservationId,
    leaseToken: oldLease, message: "late worker",
  }), false);
  const resumedStages: number[] = [];
  setSalesScriptProviderForTests(async ({ prompt }) => {
    const stage = stageFromPrompt(prompt);
    resumedStages.push(stage);
    return JSON.stringify(completeSection(stage));
  });
  await db.update(salesScriptJobs).set({ leaseExpiresAt: new Date(Date.now() - 1_000) })
    .where(eq(salesScriptJobs.id, resumed.job.id));
  assert.equal(await runOneSalesScriptJob(), true);
  assert.deepEqual(resumedStages, [2, 3, 4, 5, 6]);
  assert.equal((await storage.getSalesScriptJob(owner.failed, webinar.failed, resumed.job.id))?.status, "completed");

  // This test worker only claims its process-scoped queue, never app rows.
  const fence = await storage.purchaseSalesScript({
    ownerId: owner.other, webinarId: webinar.other, idempotencyKey: `fence-buy-${suffix}`, basicAnswers, points: SALES_SCRIPT_COST_POINTS,
  });
  assert.ok(fence);
  const fenced = await storage.attachSalesScriptPurchaseToJob({
    ownerId: owner.other, webinarId: webinar.other, purchaseId: fence.purchase.id, idempotencyKey: `fence-job-${suffix}`, answers: fullAnswers,
  });
  assert.ok(fenced);
  await db.update(salesScriptJobs).set({ queueScope: `other-test-${suffix}` }).where(eq(salesScriptJobs.id, fenced.job.id));
  assert.equal(await runOneSalesScriptJob(), false);
  // The 45-minute deadline starts from job creation, not purchase creation.
  await db.update(salesScriptJobs).set({
    queueScope: salesScriptQueueScope,
    createdAt: new Date(Date.now() - 46 * 60_000),
  }).where(eq(salesScriptJobs.id, fenced.job.id));
  setSalesScriptProviderForTests(async () => {
    throw new Error("deadline jobs must not call provider");
  });
  assert.equal(await runOneSalesScriptJob(), true);
  assert.equal((await storage.getSalesScriptJob(owner.other, webinar.other, fenced.job.id))?.status, "failed");
  const [timedOutPurchase] = await db.select().from(salesScriptPurchases).where(eq(salesScriptPurchases.id, fence.purchase.id));
  assert.equal(timedOutPurchase.status, "refunded");
});