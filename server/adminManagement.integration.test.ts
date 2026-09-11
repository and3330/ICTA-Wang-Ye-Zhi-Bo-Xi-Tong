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
import { registerRoutes } from "./routes";

test("management routes enforce role privacy, guards, idempotent grants, and live override expiry", async t => {
  // The normal test database intentionally is not migrated by `npm test`.
  // Run this integration fixture after 0022 in CI/deployment verification.
  const schema = await db.execute(sql`select count(*)::int as value from information_schema.columns where table_schema = 'public' and table_name = 'admin_mutation_idempotency' and column_name = 'payload_fingerprint'`);
  if (Number(schema.rows[0]?.value || 0) !== 1) {
    t.skip("requires additive admin-management migration 0022 with idempotency fields");
    return;
  }

  const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  const [rootId, supportId, memberId, delegatedAdminId] = ids;
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
  assert.ok(await activePublishingOverride(memberId));
  await db.update(entitlementOverrides).set({
    startsAt: new Date(Date.now() - 120_000),
    expiresAt: new Date(Date.now() - 1_000),
  }).where(eq(entitlementOverrides.id, created.id));
  assert.equal(await activePublishingOverride(memberId), undefined);

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