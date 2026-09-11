import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import express from "express";
import { createServer } from "node:http";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  adminAuditEvents, adminMutationIdempotency, aiCreditLots, aiPointTransactions, entitlementOverrides,
  memberAdminMetadata, users, webinarOffers, webinarPayments,
} from "@shared/schema";
import { db } from "./db";
import { activePublishingOverride, ensureNotLastAdmin, registerAdminManagementRoutes } from "./adminManagementRoutes";
import { activeMemberManualPlan } from "./manualPlanEntitlements";
import { registerRoutes } from "./routes";

test("management routes enforce role privacy, guards, idempotent grants, and live override expiry", async t => {
  // The normal test database intentionally is not migrated by `npm test`.
  // Run this integration fixture after 0022 in CI/deployment verification.
  const schema = await db.execute(sql`select count(*)::int as value from information_schema.columns where table_schema = 'public' and table_name = 'entitlement_overrides' and column_name = 'manual_plan'`);
  if (Number(schema.rows[0]?.value || 0) !== 1) {
    t.skip("requires additive member-manual-plans migration 0027");
    return;
  }

  const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  const [rootId, supportId, memberId, delegatedAdminId, freeMemberId] = ids;
  const offerId = crypto.randomUUID();
  const wrongPaymentId = crypto.randomUUID();
  const goodPaymentId = crypto.randomUUID();
  const suffix = crypto.randomUUID();
  const server = createServer();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = { userId: req.header("x-test-user") || undefined };
    next();
  });
  server.on("request", app);
  let refundRequests = 0;
  registerAdminManagementRoutes(app, async () => {}, {
    getStripe: async () => ({
      paymentIntents: {
        retrieve: async (id: string) => ({
          id,
          status: "succeeded",
          metadata: id === "pi_wrong"
            ? { kind: "webinar_offer", paymentId: "not-the-local-payment", offerId }
            : { kind: "webinar_offer", paymentId: goodPaymentId, offerId },
        }),
      },
      refunds: { create: async () => ({ id: `re_mock_${++refundRequests}` }) },
    } as any),
  });

  t.after(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await db.delete(adminAuditEvents).where(inArray(adminAuditEvents.actorUserId, ids));
    await db.delete(entitlementOverrides).where(inArray(entitlementOverrides.userId, ids));
    await db.delete(adminAuditEvents).where(inArray(adminAuditEvents.targetUserId, ids));
    await db.delete(adminMutationIdempotency).where(inArray(adminMutationIdempotency.actorUserId, ids));
    await db.delete(aiPointTransactions).where(inArray(aiPointTransactions.userId, ids));
    await db.delete(aiCreditLots).where(inArray(aiCreditLots.userId, ids));
    await db.delete(webinarPayments).where(inArray(webinarPayments.id, [wrongPaymentId, goodPaymentId]));
    await db.delete(webinarOffers).where(eq(webinarOffers.id, offerId));
    await db.delete(memberAdminMetadata).where(inArray(memberAdminMetadata.userId, ids));
    await db.delete(users).where(inArray(users.id, ids));
  });

  await db.insert(users).values([
    { id: rootId, username: `root-${suffix}`, password: "test", email: `root-${suffix}@example.test`, isActive: true, isSuperAdmin: true },
    { id: supportId, username: `support-${suffix}`, password: "test", email: `support-${suffix}@example.test`, isActive: true },
    { id: memberId, username: `member-${suffix}`, password: "test", email: `member-${suffix}@example.test`, isActive: true, subscriptionPlan: "growth", subscriptionStatus: "active", aiPoints: 777 },
    { id: delegatedAdminId, username: `delegated-${suffix}`, password: "test", email: `delegated-${suffix}@example.test`, isActive: true },
    { id: freeMemberId, username: `manual-free-${suffix}`, password: "test", email: `manual-free-${suffix}@example.test`, isActive: true, subscriptionPlan: "free", subscriptionStatus: "inactive" },
  ]);
  await db.insert(memberAdminMetadata).values([
    { userId: supportId, managementRole: "support", notes: [], tags: [] },
    { userId: delegatedAdminId, managementRole: "super_admin", notes: [], tags: [] },
    // This role contains grants and entitlement overrides, while still
    // permitting the support-role privacy assertion above.
    { userId: rootId, managementRole: "super_admin", notes: [], tags: [] },
  ]);
  await db.insert(webinarOffers).values({ id: offerId, userId: memberId, paymentProvider: "stripe", stripeProductId: "prod_fixture", stripePriceId: "price_fixture" });
  await db.insert(webinarPayments).values([
    { id: wrongPaymentId, userId: memberId, offerId, paymentProvider: "stripe", stripeCheckoutSessionId: `cs_wrong_${suffix}`, stripePaymentIntentId: "pi_wrong", amountMinor: 1000, currency: "USD", status: "paid" },
    { id: goodPaymentId, userId: memberId, offerId, paymentProvider: "stripe", stripeCheckoutSessionId: `cs_good_${suffix}`, stripePaymentIntentId: "pi_good", amountMinor: 1000, currency: "USD", status: "paid" },
  ]);

  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  const call = (path: string, userId: string, method = "GET", body?: unknown) => fetch(`${base}${path}`, {
    method, headers: { "x-test-user": userId, ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const supportDetail = await call(`/api/management/members/${memberId}`, supportId);
  assert.equal(supportDetail.status, 200);
  const supportPayload: any = await supportDetail.json();
  assert.equal("aiPoints" in supportPayload.profile, false);
  assert.equal("subscriptionPlan" in supportPayload.profile, false);
  assert.equal("usage" in supportPayload, false);
  assert.equal("subscription" in supportPayload, false);
  assert.equal((await call(`/api/management/members/${memberId}`, memberId)).status, 403);
  assert.equal((await call(`/api/management/members/${delegatedAdminId}/profile`, supportId, "PATCH", {
    email: `takeover-${suffix}@example.test`, reason: "must not change staff identity",
  })).status, 403);
  assert.equal((await call(`/api/management/members/${delegatedAdminId}/password-reset`, supportId, "POST", {
    reason: "must not request staff reset",
  })).status, 403);
  // Isolate the count response; shared test databases can contain unrelated
  // real roots and must never be modified by this assertion.
  const root = (await db.select().from(users).where(eq(users.id, rootId)).limit(1))[0];
  await assert.rejects(
    ensureNotLastAdmin({
      select: () => ({ from: () => ({ leftJoin: () => ({ where: async () => [{ value: 1 }] }) }) }),
    }, root, "super_admin", true),
    (error: any) => error?.status === 403,
  );

  const selfRole = await call(`/api/management/members/${rootId}/role`, rootId, "PATCH", { role: "read_only", reason: "must fail" });
  assert.equal(selfRole.status, 403);
  await db.update(users).set({ isActive: false }).where(eq(users.id, supportId));
  assert.equal((await call(`/api/management/members/${memberId}`, supportId)).status, 403);
  await db.update(users).set({ isActive: true }).where(eq(users.id, supportId));

  const grant = { points: 13, reason: "integration idempotency", idempotencyKey: "same-grant-key" };
  const [first, second] = await Promise.all([
    call(`/api/management/members/${memberId}/ai-grants`, rootId, "POST", grant),
    call(`/api/management/members/${memberId}/ai-grants`, rootId, "POST", grant),
  ]);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  const grantRows = await db.select().from(aiCreditLots).where(and(
    eq(aiCreditLots.userId, memberId), eq(aiCreditLots.idempotencyKey, `admin-grant:${memberId}:same-grant-key`),
  ));
  assert.equal(grantRows.length, 1);

  const override = await call(`/api/management/members/${memberId}/overrides`, rootId, "POST", {
    publishingSlots: 1, expiresAt: new Date(Date.now() + 120_000).toISOString(), reason: "temporary support access",
  });
  assert.equal(override.status, 201);
  const created: any = await override.json();
  await db.insert(entitlementOverrides).values({
    userId: memberId, publishingSlots: 100, startsAt: new Date(Date.now() - 60_000),
    expiresAt: new Date(Date.now() + 60_000), reason: "higher but earlier override", createdBy: rootId,
  });
  // Selection is capacity-first, not simply the longest remaining grant.
  assert.equal((await activePublishingOverride(memberId))?.publishingSlots, 100);
  await db.update(entitlementOverrides).set({
    startsAt: new Date(Date.now() - 120_000),
    expiresAt: new Date(Date.now() - 1_000),
  }).where(eq(entitlementOverrides.userId, memberId));
  assert.equal(await activePublishingOverride(memberId), undefined);

  // A manual grant is a versioned, audited entitlement only. It does not
  // overwrite the paid fields used as Stripe's local cache.
  const manualCreate = {
    plan: "growth", startsAt: new Date(Date.now() - 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    reason: "time-limited manual access", idempotencyKey: "manual-plan-create",
  };
  const createdManualResponse = await call(`/api/management/members/${freeMemberId}/manual-plan`, rootId, "POST", manualCreate);
  assert.equal(createdManualResponse.status, 201);
  const createdManual: any = await createdManualResponse.json();
  assert.equal(createdManual.state, "active");
  assert.equal(createdManual.plan, "growth");
  assert.ok(await activeMemberManualPlan(freeMemberId));
  assert.equal((await call(`/api/management/members/${freeMemberId}/overrides/${createdManual.id}`, rootId, "DELETE", {
    reason: "old override endpoint must not delete manual grant",
  })).status, 404);
  const manualDetail: any = await (await call(`/api/management/members/${freeMemberId}`, rootId)).json();
  assert.equal(manualDetail.subscription.plan, "free");
  assert.equal(manualDetail.effectivePlan.plan, "growth");
  assert.equal(manualDetail.effectivePlan.source, "manual");
  assert.equal(manualDetail.manualPlan.version, 1);
  const manualUpdate = await call(`/api/management/members/${freeMemberId}/manual-plan`, rootId, "PATCH", {
    plan: "scale", extendHours: 2, reason: "extend and increase capacity", version: 1, idempotencyKey: "manual-plan-update",
  });
  assert.equal(manualUpdate.status, 200);
  const updatedManual: any = await manualUpdate.json();
  assert.equal(updatedManual.plan, "scale");
  assert.equal(updatedManual.version, 2);
  await db.update(entitlementOverrides).set({ expiresAt: new Date(Date.now() - 1_000) })
    .where(eq(entitlementOverrides.id, updatedManual.id));
  const revivedManualResponse = await call(`/api/management/members/${freeMemberId}/manual-plan`, rootId, "PATCH", {
    extendHours: 24, reason: "revive from elapsed stored expiry", version: 2, idempotencyKey: "manual-plan-revive",
  });
  assert.equal(revivedManualResponse.status, 200);
  const revivedManual: any = await revivedManualResponse.json();
  assert.equal(revivedManual.version, 3);
  assert.ok(new Date(revivedManual.expiresAt).getTime() > Date.now());
  assert.ok(await activeMemberManualPlan(freeMemberId));
  assert.equal((await call(`/api/management/members/${freeMemberId}/manual-plan`, rootId, "DELETE", {
    reason: "stale version", version: 1, idempotencyKey: "manual-plan-stale-revoke",
  })).status, 409);
  const manualRevoke = await call(`/api/management/members/${freeMemberId}/manual-plan`, rootId, "DELETE", {
    reason: "manual period ended early", version: 3, idempotencyKey: "manual-plan-revoke",
  });
  assert.equal(manualRevoke.status, 200);
  assert.equal((await manualRevoke.json() as any).state, "revoked");
  assert.equal(await activeMemberManualPlan(freeMemberId), undefined);
  const freeAfter = (await db.select().from(users).where(eq(users.id, freeMemberId)).limit(1))[0];
  assert.equal(freeAfter.subscriptionPlan, "free");
  assert.equal(freeAfter.subscriptionStatus, "inactive");

  const refundBody = { amountMinor: 100, reason: "fixture refund", idempotencyKey: "same-refund-key" };
  // The buyer customer is intentionally absent from the mock: attribution,
  // not the seller's SaaS Stripe customer, is the ownership check.
  assert.equal((await call(`/api/management/orders/${wrongPaymentId}/refunds`, rootId, "POST", refundBody)).status, 409);
  assert.equal(refundRequests, 0);
  const [refundOne, refundTwo] = await Promise.all([
    call(`/api/management/orders/${goodPaymentId}/refunds`, rootId, "POST", refundBody),
    call(`/api/management/orders/${goodPaymentId}/refunds`, rootId, "POST", refundBody),
  ]);
  assert.equal(refundOne.status, 202);
  assert.equal(refundTwo.status, 202);
  assert.equal(refundRequests, 1);

  // The full route registrar owns the legacy paths. They must not remain an
  // un-audited alternate mutation surface, and an inactive root cannot use
  // even the retained read-only legacy endpoints.
  const legacyApp = express();
  legacyApp.use(express.json());
  legacyApp.use((req: any, _res, next) => {
    req.session = { userId: req.header("x-test-user") || undefined };
    next();
  });
  const legacyServer = createServer(legacyApp);
  await registerRoutes(legacyServer, legacyApp, (req: any, _res, next) => {
    req.session = { userId: req.header("x-test-user") || undefined };
    next();
  }, { startScheduler: () => {} });
  await new Promise<void>(resolve => legacyServer.listen(0, "127.0.0.1", resolve));
  const legacyAddress = legacyServer.address();
  assert.ok(legacyAddress && typeof legacyAddress === "object");
  const legacyBase = `http://127.0.0.1:${legacyAddress.port}`;
  const legacyMutation = await fetch(`${legacyBase}/api/super-admin/users/${memberId}`, {
    method: "PATCH", headers: { "x-test-user": rootId, "content-type": "application/json" }, body: "{}",
  });
  assert.equal(legacyMutation.status, 410);
  await db.update(users).set({ isActive: false }).where(eq(users.id, rootId));
  assert.equal((await fetch(`${legacyBase}/api/super-admin/users`, { headers: { "x-test-user": rootId } })).status, 403);
  await new Promise<void>((resolve, reject) => legacyServer.close(error => error ? reject(error) : resolve()));
});