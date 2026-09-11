import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import {
  aiReplyLogs,
  aiResponseArtifacts,
  noCardTrialAiCalls,
  noCardTrials,
  users,
  webinarDocuments,
  webinars,
} from "@shared/schema";
import { db } from "./db";
import {
  completeTrialAiCall,
  ensureNoCardTrial,
  getActiveNoCardTrial,
  getNoCardTrialStatus,
  refundTrialAiCall,
  reserveTrialAiCall,
} from "./noCardTrial";
import { runAiReply } from "./aiReplyService";

async function createTestUser(overrides: Record<string, unknown> = {}) {
  const id = crypto.randomUUID();
  await db.insert(users).values({
    id,
    username: `no-card-${id}`,
    password: "test-only-hash",
    email: `${id}@example.test`,
    ...overrides,
  } as any);
  return id;
}

async function deleteTestUser(id: string) {
  await db.delete(noCardTrialAiCalls).where(eq(noCardTrialAiCalls.userId, id));
  await db.delete(noCardTrials).where(eq(noCardTrials.userId, id));
  await db.delete(users).where(eq(users.id, id));
}

test("no-card trial eligibility, expiry, and one-ever paid exclusion", async (t) => {
  assert.equal(process.env.NODE_ENV, "test", "integration test refuses non-test execution");
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL is required for PostgreSQL integration testing");
  const eligibleUserId = await createTestUser();
  const claimedTrialUserId = await createTestUser({ stripeTrialClaimedAt: new Date() });
  const paidUserId = await createTestUser({ stripeCustomerId: "cus_prior_paid_account" });
  const expiredUserId = await createTestUser();
  t.after(async () => {
    await Promise.all([eligibleUserId, claimedTrialUserId, paidUserId, expiredUserId].map(deleteTestUser));
  });

  const first = await ensureNoCardTrial(eligibleUserId);
  assert.ok(first);
  const repeated = await ensureNoCardTrial(eligibleUserId);
  assert.equal(repeated?.userId, first.userId, "second activation returns the immutable original row");
  assert.equal(repeated?.startsAt.getTime(), first.startsAt.getTime());
  assert.ok(await getActiveNoCardTrial(eligibleUserId));
  await db.update(users).set({ subscriptionPlan: "starter", subscriptionStatus: "active" })
    .where(eq(users.id, eligibleUserId));
  assert.equal((await getNoCardTrialStatus(eligibleUserId)).state, "upgraded", "paid access takes precedence without resetting the retained trial");
  assert.equal(await getActiveNoCardTrial(eligibleUserId), null);
  assert.equal(await ensureNoCardTrial(claimedTrialUserId), null, "prior Stripe trial excludes no-card trial");
  assert.equal(await ensureNoCardTrial(paidUserId), null, "prior paid Stripe customer excludes a second trial");

  const startsAt = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
  await db.insert(noCardTrials).values({
    userId: expiredUserId,
    startsAt,
    expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    retentionUntil: new Date(Date.now() + 31 * 24 * 60 * 60 * 1000),
  });
  assert.equal(await getActiveNoCardTrial(expiredUserId), null, "expiry is evaluated live");
  assert.equal((await getNoCardTrialStatus(expiredUserId)).state, "expired");
});

test("trial AI ledger atomically caps at 50 and refunded calls are reusable", async (t) => {
  assert.equal(process.env.NODE_ENV, "test", "integration test refuses non-test execution");
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL is required for PostgreSQL integration testing");
  const userId = await createTestUser();
  t.after(() => deleteTestUser(userId));
  assert.ok(await ensureNoCardTrial(userId));

  const reservations = await Promise.all(Array.from({ length: 50 }, () => reserveTrialAiCall(userId)));
  assert.equal(reservations.filter(Boolean).length, 50, "concurrent requests cannot oversubscribe the cap");
  assert.equal(await reserveTrialAiCall(userId), null, "51st provider request is rejected");

  const refunded = reservations[0]!;
  assert.equal(await refundTrialAiCall(refunded.reservationId), true);
  assert.equal(await refundTrialAiCall(refunded.reservationId), false, "refund is idempotent");
  const replacement = await reserveTrialAiCall(userId);
  assert.ok(replacement, "a provider failure returns exactly one call to the ledger");
  assert.equal(await completeTrialAiCall(replacement.reservationId), true);
  assert.equal((await getNoCardTrialStatus(userId)).usedAI, 50);
});

test("a stubbed provider is reserved, completed, or refunded through the trial ledger", async (t) => {
  assert.equal(process.env.NODE_ENV, "test", "integration test refuses non-test execution");
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL is required for PostgreSQL integration testing");
  const userId = await createTestUser();
  const webinarId = crypto.randomUUID();
  t.after(async () => {
    await db.delete(aiReplyLogs).where(eq(aiReplyLogs.webinarId, webinarId));
    await db.delete(aiResponseArtifacts).where(eq(aiResponseArtifacts.webinarId, webinarId));
    await db.delete(webinarDocuments).where(eq(webinarDocuments.webinarId, webinarId));
    await db.delete(webinars).where(eq(webinars.id, webinarId));
    await deleteTestUser(userId);
  });
  assert.ok(await ensureNoCardTrial(userId));
  await db.insert(webinars).values({
    id: webinarId,
    userId,
    title: "Trial provider billing",
    vimeoUrl: "",
    startTime: new Date("2030-01-01T00:00:00Z"),
    aiSettings: { enabled: true, teacherName: "Trial assistant", knowledgeOnly: false },
  });

  let providerCalls = 0;
  const success = await runAiReply({
    webinarId,
    question: "請問這是測試嗎？",
    kind: "test",
    provider: async () => {
      providerCalls += 1;
      return { text: "是，這是已計費的試用回答。" };
    },
  });
  assert.equal(providerCalls, 1);
  assert.equal(success.status, "answered");
  assert.equal(success.pointsCharged, 0, "trial calls never debit paid points");

  const failed = await runAiReply({
    webinarId,
    question: "第二次測試會退款嗎？",
    kind: "test",
    provider: async () => {
      providerCalls += 1;
      throw new Error("injected provider failure");
    },
  });
  assert.equal(providerCalls, 2);
  assert.equal(failed.status, "error");
  const statuses = await db.select({ status: noCardTrialAiCalls.status }).from(noCardTrialAiCalls)
    .where(eq(noCardTrialAiCalls.userId, userId));
  assert.deepEqual(statuses.map(row => row.status).sort(), ["completed", "refunded"]);
  assert.equal((await getNoCardTrialStatus(userId)).usedAI, 1);
});