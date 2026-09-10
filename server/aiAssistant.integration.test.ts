import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import express, { type RequestHandler } from "express";
import { createServer } from "node:http";
import { and, eq, inArray } from "drizzle-orm";
import {
  aiCreditLots,
  aiCreditReservations,
  aiReplyLogs,
  aiResponseArtifacts,
  chatMessages,
  users,
  webinarDocuments,
  webinars,
} from "@shared/schema";
import { db } from "./db";
import { registerAiManagementRoutes } from "./aiManagementRoutes";
import { runAiReply } from "./aiReplyService";

test("AI reply runtime and correction management persist atomically in the development database", async t => {
  const suffix = crypto.randomUUID();
  const paidOwnerId = crypto.randomUUID();
  const unlimitedOwnerId = crypto.randomUUID();
  const paidWebinarId = crypto.randomUUID();
  const strictWebinarId = crypto.randomUUID();
  const unlimitedWebinarId = crypto.randomUUID();
  const webinarIds = [paidWebinarId, strictWebinarId, unlimitedWebinarId];
  const ownerIds = [paidOwnerId, unlimitedOwnerId];

  t.after(async () => {
    await db.delete(aiReplyLogs).where(inArray(aiReplyLogs.webinarId, webinarIds));
    await db.delete(aiResponseArtifacts).where(inArray(aiResponseArtifacts.webinarId, webinarIds));
    await db.delete(chatMessages).where(inArray(chatMessages.webinarId, webinarIds));
    await db.delete(webinarDocuments).where(inArray(webinarDocuments.webinarId, webinarIds));
    await db.delete(webinars).where(inArray(webinars.id, webinarIds));
    await db.delete(aiCreditReservations).where(inArray(aiCreditReservations.userId, ownerIds));
    await db.delete(users).where(inArray(users.id, ownerIds));
  });

  await db.insert(users).values([
    {
      id: paidOwnerId,
      username: `ai-paid-${suffix}`,
      password: "test-only",
      email: `paid-${suffix}@example.test`,
      isActive: true,
      subscriptionPlan: "starter",
      subscriptionStatus: "active",
      aiPoints: 5,
    },
    {
      id: unlimitedOwnerId,
      username: `ai-unlimited-${suffix}`,
      password: "test-only",
      email: `unlimited-${suffix}@example.test`,
      isActive: true,
      subscriptionPlan: "enterprise",
      subscriptionStatus: "active",
      aiPoints: 0,
    },
  ]);
  await db.insert(webinars).values([
    {
      id: paidWebinarId,
      userId: paidOwnerId,
      title: "付費 AI 測試講座",
      vimeoUrl: "",
      startTime: new Date("2030-01-01T00:00:00Z"),
      aiSettings: {
        enabled: true,
        teacherName: "測試老師",
        instructions: "簡短回答",
        knowledgeOnly: true,
        fallbackMessage: "資料不足",
        outOfPointsMessage: "點數不足",
      },
    },
    {
      id: strictWebinarId,
      userId: paidOwnerId,
      title: "嚴格知識測試講座",
      vimeoUrl: "",
      startTime: new Date("2030-01-01T00:00:00Z"),
      aiSettings: {
        enabled: true,
        teacherName: "測試老師",
        knowledgeOnly: true,
        fallbackMessage: "嚴格模式資料不足",
      },
    },
    {
      id: unlimitedWebinarId,
      userId: unlimitedOwnerId,
      title: "無限點數測試講座",
      vimeoUrl: "",
      startTime: new Date("2030-01-01T00:00:00Z"),
      aiSettings: {
        enabled: true,
        teacherName: "企業老師",
        knowledgeOnly: true,
      },
    },
  ]);
  await db.insert(aiCreditLots).values({
    userId: paidOwnerId,
    source: "admin_grant",
    originalPoints: 5,
    remainingPoints: 5,
    idempotencyKey: `ai-integration:${suffix}`,
  });
  await db.insert(webinarDocuments).values([
    {
      webinarId: paidWebinarId,
      title: "課程價格",
      content: "本課程價格是新台幣 3,000 元。",
      sourceType: "text",
    },
    {
      webinarId: unlimitedWebinarId,
      title: "企業課程時間",
      content: "企業課程在每週五晚上八點開始。",
      sourceType: "text",
    },
  ]);

  const paid = await runAiReply({
    webinarId: paidWebinarId,
    sessionId: `viewer-${suffix}`,
    question: "本課程價格是多少？",
    kind: "live",
    provider: async input => {
      assert.match(input.systemPrompt, /簡短回答/);
      return { text: "本課程價格是新台幣 3,000 元。", model: "injected-integration-model" };
    },
  });
  assert.equal(paid.status, "answered");
  assert.equal(paid.pointsCharged, 1);
  assert.ok(paid.chatMessage);

  const [paidLog] = await db.select().from(aiReplyLogs).where(eq(aiReplyLogs.id, paid.logId));
  assert.equal(paidLog.question, "本課程價格是多少？");
  assert.equal(paidLog.answer, paid.answer);
  assert.equal(paidLog.chatMessageId, paid.chatMessage!.id);
  assert.equal(paidLog.pointsCharged, 1);
  assert.equal(paidLog.model, "injected-integration-model");
  assert.equal((paidLog.sources as unknown[]).length, 1);
  const [paidReservation] = await db.select().from(aiCreditReservations)
    .where(eq(aiCreditReservations.id, paidLog.reservationId!));
  assert.equal(paidReservation.status, "consumed");
  const [paidArtifact] = await db.select().from(aiResponseArtifacts)
    .where(eq(aiResponseArtifacts.reservationId, paidReservation.id));
  assert.equal(paidArtifact.responseText, paid.answer);
  const [paidLotAfterSuccess] = await db.select().from(aiCreditLots)
    .where(eq(aiCreditLots.userId, paidOwnerId));
  assert.equal(paidLotAfterSuccess.remainingPoints, 4);

  const failed = await runAiReply({
    webinarId: paidWebinarId,
    question: "課程價格是多少？",
    kind: "test",
    provider: async () => {
      throw new Error("provider details must not be persisted");
    },
  });
  assert.equal(failed.status, "error");
  assert.equal(failed.pointsCharged, 0);
  const [failedLog] = await db.select().from(aiReplyLogs).where(eq(aiReplyLogs.id, failed.logId));
  assert.equal(failedLog.status, "error");
  assert.equal(failedLog.answer, null);
  assert.doesNotMatch(failedLog.errorMessage || "", /provider details/);
  const [failedReservation] = await db.select().from(aiCreditReservations)
    .where(eq(aiCreditReservations.id, failedLog.reservationId!));
  assert.equal(failedReservation.status, "refunded");
  const [paidLotAfterFailure] = await db.select().from(aiCreditLots)
    .where(eq(aiCreditLots.userId, paidOwnerId));
  assert.equal(paidLotAfterFailure.remainingPoints, 4);

  let strictProviderCalls = 0;
  const strict = await runAiReply({
    webinarId: strictWebinarId,
    question: "有停車位嗎？",
    kind: "test",
    provider: async () => {
      strictProviderCalls += 1;
      return { text: "不應被呼叫" };
    },
  });
  assert.equal(strict.status, "fallback");
  assert.equal(strict.answer, "嚴格模式資料不足");
  assert.equal(strict.pointsCharged, 0);
  assert.equal(strictProviderCalls, 0);
  const [strictLog] = await db.select().from(aiReplyLogs).where(eq(aiReplyLogs.id, strict.logId));
  assert.equal(strictLog.reservationId, null);
  assert.equal(strictLog.model, null);

  const unlimited = await runAiReply({
    webinarId: unlimitedWebinarId,
    question: "企業課程何時開始？",
    kind: "test",
    provider: async () => ({ text: "企業課程在每週五晚上八點開始。", model: "injected-unlimited-model" }),
  });
  assert.equal(unlimited.status, "answered");
  assert.equal(unlimited.unlimited, true);
  assert.equal(unlimited.pointsCharged, 0);
  const [unlimitedLog] = await db.select().from(aiReplyLogs).where(eq(aiReplyLogs.id, unlimited.logId));
  assert.equal(unlimitedLog.pointsCharged, 0);
  assert.equal(unlimitedLog.reservationId, null);
  const [unlimitedArtifact] = await db.select().from(aiResponseArtifacts)
    .where(and(
      eq(aiResponseArtifacts.webinarId, unlimitedWebinarId),
      eq(aiResponseArtifacts.requestText, "企業課程何時開始？"),
    ));
  assert.ok(unlimitedArtifact);

  const requireOwner: RequestHandler = async (req, res, next) => {
    const userId = req.header("x-test-user-id");
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const [webinar] = await db.select({ userId: webinars.userId }).from(webinars)
      .where(eq(webinars.id, req.params.id as string));
    if (!webinar || webinar.userId !== userId) return res.status(403).json({ message: "Forbidden" });
    next();
  };
  const app = express();
  app.use(express.json());
  registerAiManagementRoutes(app, requireOwner);
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close(error => error ? reject(error) : resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}/api/webinars`;
  const correction = {
    reviewStatus: "corrected",
    correctedAnswer: "正確價格是新台幣 2,500 元。",
    notes: "價格已更新",
    addToKnowledge: true,
  };
  const correctedResponse = await fetch(`${base}/${paidWebinarId}/ai/logs/${paid.logId}/review`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-test-user-id": paidOwnerId },
    body: JSON.stringify(correction),
  });
  assert.equal(correctedResponse.status, 200);
  const corrected = await correctedResponse.json() as {
    question: string;
    answer: string;
    correctedAnswer: string;
    correctionDocumentId: string;
  };
  assert.equal(corrected.question, paidLog.question);
  assert.equal(corrected.answer, paidLog.answer);
  assert.equal(corrected.correctedAnswer, correction.correctedAnswer);
  assert.ok(corrected.correctionDocumentId);

  const secondCorrection = "正確價格是新台幣 2,400 元。";
  const secondResponse = await fetch(`${base}/${paidWebinarId}/ai/logs/${paid.logId}/review`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-test-user-id": paidOwnerId },
    body: JSON.stringify({
      reviewStatus: "corrected",
      correctedAnswer: secondCorrection,
      addToKnowledge: true,
    }),
  });
  assert.equal(secondResponse.status, 200);
  const secondReview = await secondResponse.json() as { correctionDocumentId: string };
  assert.equal(secondReview.correctionDocumentId, corrected.correctionDocumentId);
  const correctionDocuments = await db.select().from(webinarDocuments).where(and(
    eq(webinarDocuments.webinarId, paidWebinarId),
    eq(webinarDocuments.sourceType, "correction"),
  ));
  assert.equal(correctionDocuments.length, 1);
  assert.match(correctionDocuments[0].content, /2,400/);
  const [reviewedLog] = await db.select().from(aiReplyLogs).where(eq(aiReplyLogs.id, paid.logId));
  assert.equal(reviewedLog.question, paidLog.question);
  assert.equal(reviewedLog.answer, paidLog.answer);
  assert.equal(reviewedLog.correctedAnswer, secondCorrection);

  const crossOwner = await fetch(`${base}/${paidWebinarId}/ai/logs/${paid.logId}/review`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-test-user-id": unlimitedOwnerId },
    body: JSON.stringify(correction),
  });
  assert.equal(crossOwner.status, 403);
  const foreignLog = await fetch(`${base}/${paidWebinarId}/ai/logs/${unlimited.logId}/review`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-test-user-id": paidOwnerId },
    body: JSON.stringify(correction),
  });
  assert.equal(foreignLog.status, 404);
});