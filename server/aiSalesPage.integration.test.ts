import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import express, { type RequestHandler } from "express";
import { createServer } from "node:http";
import { eq } from "drizzle-orm";
import {
  noCardTrialAiCalls,
  noCardTrials,
  offerSalesPages,
  users,
  webinarOffers,
} from "@shared/schema";
import { db } from "./db";
import { registerAiSalesPageRoutes, setSalesPageAiProviderForTests } from "./aiSalesPage";
import { ensureNoCardTrial } from "./noCardTrial";

test("AI sales-page endpoint uses one stubbed call, returns a safe unsaved draft, and refunds failure", async (t) => {
  assert.equal(process.env.NODE_ENV, "test", "integration test refuses non-test execution");
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL is required for PostgreSQL integration testing");
  const suffix = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const offerId = crypto.randomUUID();
  const pageId = crypto.randomUUID();
  t.after(async () => {
    setSalesPageAiProviderForTests();
    await db.delete(offerSalesPages).where(eq(offerSalesPages.id, pageId));
    await db.delete(webinarOffers).where(eq(webinarOffers.id, offerId));
    await db.delete(noCardTrialAiCalls).where(eq(noCardTrialAiCalls.userId, userId));
    await db.delete(noCardTrials).where(eq(noCardTrials.userId, userId));
    await db.delete(users).where(eq(users.id, userId));
  });
  await db.insert(users).values({
    id: userId, username: `page-ai-${suffix}`, password: "test-only",
    email: `page-ai-${suffix}@example.test`, isActive: true,
    subscriptionPlan: "free", subscriptionStatus: "inactive",
  });
  await ensureNoCardTrial(userId);
  await db.insert(webinarOffers).values({
    id: offerId, userId, paymentProvider: "ecpay", ecpayItemName: "真實課程",
    ecpayAmountTwd: 3_000, checkoutMode: "payment", active: true,
  });
  await db.insert(offerSalesPages).values({
    id: pageId, userId, offerId, slug: `page-ai-${suffix.slice(0, 12)}`,
    title: "真實銷售頁", orderedBlocks: [],
  });

  let calls = 0;
  setSalesPageAiProviderForTests(async () => {
    calls += 1;
    return JSON.stringify({
      headline: "認識真實課程", subheadline: "依您的 brief 安排清楚的介紹。",
      benefitsHeadline: "課程重點", benefits: ["整理重點", "規劃下一步"],
      offerHeadline: "選擇真實課程", buttonLabel: "查看課程",
      faq: [{ question: "這是什麼課程？", answer: "這是依產品資訊撰寫的課程頁草稿。" }],
    });
  });
  const requireAdmin: RequestHandler = (req: any, _res, next) => {
    req.session = { userId };
    next();
  };
  const app = express();
  app.use(express.json());
  registerAiSalesPageRoutes(app, requireAdmin);
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const endpoint = `http://127.0.0.1:${address.port}/api/product-sales-pages/${pageId}/ai-draft`;

  const success = await fetch(endpoint, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ brief: "用清楚、克制的中文介紹", audience: "想了解課程的人" }),
  });
  assert.equal(success.status, 200);
  const draft = await success.json() as { blocks: Array<Record<string, unknown>>; cost: { kind: string; amount: number } };
  assert.equal(calls, 1);
  assert.deepEqual(draft.cost, { kind: "trial_call", amount: 1, remaining: 49 });
  assert.equal(draft.blocks.filter(block => block.type === "offer").length, 1);
  assert.equal(draft.blocks.find(block => block.type === "offer")?.priceLabel, "NT$ 3,000");
  assert.equal(JSON.stringify(draft.blocks).includes("<"), false, "draft contains data-only safe blocks");
  const [unchanged] = await db.select().from(offerSalesPages).where(eq(offerSalesPages.id, pageId));
  assert.deepEqual(unchanged.orderedBlocks, [], "generation never saves a draft automatically");
  assert.equal(unchanged.publishedOrderedBlocks, null);

  setSalesPageAiProviderForTests(async () => {
    calls += 1;
    throw new Error("injected failure");
  });
  const failed = await fetch(endpoint, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ brief: "這次應退款" }),
  });
  assert.equal(failed.status, 502);
  assert.equal(calls, 2);
  const callStatuses = await db.select({ status: noCardTrialAiCalls.status }).from(noCardTrialAiCalls)
    .where(eq(noCardTrialAiCalls.userId, userId));
  assert.deepEqual(callStatuses.map(row => row.status).sort(), ["completed", "refunded"]);

  const snapshot = [{ id: "snapshot", type: "richText", enabled: true, content: "published immutable snapshot" }];
  const publishedAt = new Date("2030-01-02T03:04:05.000Z");
  await db.update(offerSalesPages).set({ status: "published", publishedOrderedBlocks: snapshot, publishedAt }).where(eq(offerSalesPages.id, pageId));
  setSalesPageAiProviderForTests(async () => {
    calls += 1;
    return JSON.stringify({
      headline: "更新中的提案", subheadline: "此提案不會碰觸公開快照。",
      benefitsHeadline: "更新重點", benefits: ["保留已發布內容"],
      offerHeadline: "真實課程", buttonLabel: "了解課程",
      faq: [{ question: "會自動發布嗎？", answer: "不會，必須由使用者明確儲存與發布。" }],
    });
  });
  const published = await fetch(endpoint, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ brief: "為已發布頁建立下一版提案" }),
  });
  assert.equal(published.status, 200);
  assert.equal(calls, 3, "published pages still receive a proposal, not an automatic edit");
  const publishedDraft = await published.json() as { blocks: Array<Record<string, unknown>> };
  assert.equal(publishedDraft.blocks[0]?.headline, "更新中的提案");
  const [afterPublished] = await db.select().from(offerSalesPages).where(eq(offerSalesPages.id, pageId));
  assert.deepEqual(afterPublished.publishedOrderedBlocks, snapshot);
  assert.equal(afterPublished.publishedAt?.getTime(), publishedAt.getTime());
});