import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import express from "express";
import { createServer } from "node:http";
import { and, eq, inArray } from "drizzle-orm";
import { db, pool } from "./db";
import { registerRoutes } from "./routes";
import { ecpayConnections, memberOrderEvents, users, webinarOffers, webinarPayments } from "@shared/schema";

// Database-backed HTTP fixture: it only creates unique test rows and makes no
// provider or email calls. Run after migration 0024 has been applied.
test("member orders: ownership, filters, revenue, operations and safe export", async (t) => {
  assert.notEqual(process.env.NODE_ENV, "production");
  const suffix = crypto.randomUUID();
  const ownerId = crypto.randomUUID();
  const otherId = crypto.randomUUID();
  const rootId = crypto.randomUUID();
  const offerId = crypto.randomUUID();
  const otherOfferId = crypto.randomUUID();
  const ownerConnectionId = crypto.randomUUID();
  const otherConnectionId = crypto.randomUUID();
  const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = req.header("x-test-user") ? { userId: req.header("x-test-user") } : {};
    next();
  });
  const server = createServer(app);
  await registerRoutes(server, app, undefined, { startScheduler: () => {} });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  const call = (path: string, actor?: string, method = "GET", body?: unknown) => fetch(`${base}${path}`, {
    method,
    headers: { ...(actor ? { "x-test-user": actor } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  t.after(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await db.delete(memberOrderEvents).where(inArray(memberOrderEvents.paymentId, ids));
    await db.delete(webinarPayments).where(inArray(webinarPayments.id, ids));
    await db.delete(webinarOffers).where(inArray(webinarOffers.id, [offerId, otherOfferId]));
    await db.delete(ecpayConnections).where(inArray(ecpayConnections.id, [ownerConnectionId, otherConnectionId]));
    await db.delete(users).where(inArray(users.id, [ownerId, otherId, rootId]));
    await pool.end();
  });

  await db.insert(users).values([
    { id: ownerId, username: `orders-owner-${suffix}`, password: "test", email: `owner-${suffix}@example.test`, isActive: true },
    { id: otherId, username: `orders-other-${suffix}`, password: "test", email: `other-${suffix}@example.test`, isActive: true },
    { id: rootId, username: `orders-root-${suffix}`, password: "test", email: `root-${suffix}@example.test`, isActive: true, isSuperAdmin: true },
  ]);
  await db.insert(webinarOffers).values([
    { id: offerId, userId: ownerId, paymentProvider: "ecpay", ecpayItemName: "Recorded product", ecpayAmountTwd: 1 },
    { id: otherOfferId, userId: otherId, paymentProvider: "ecpay", ecpayItemName: "Other product", ecpayAmountTwd: 1 },
  ]);
  await db.insert(ecpayConnections).values([
    { id: ownerConnectionId, userId: ownerId, merchantId: "3002607", environment: "stage", hashKeyEncrypted: "fixture", hashIvEncrypted: "fixture" },
    { id: otherConnectionId, userId: otherId, merchantId: "3002608", environment: "stage", hashKeyEncrypted: "fixture", hashIvEncrypted: "fixture" },
  ]);
  await db.insert(webinarPayments).values([
    { id: ids[0], userId: ownerId, offerId, paymentProvider: "ecpay", providerOrderId: `owner-paid-${suffix}`.slice(0, 64), ecpayConnectionId: ownerConnectionId, merchantIdSnapshot: "3002607", amountMinor: 100, currency: "TWD", status: "paid", productNameSnapshot: "Recorded product", buyerNameSnapshot: "Alice", buyerEmailSnapshot: "alice@example.test" },
    { id: ids[1], userId: ownerId, offerId, paymentProvider: "ecpay", providerOrderId: `owner-refund-${suffix}`.slice(0, 64), ecpayConnectionId: ownerConnectionId, merchantIdSnapshot: "3002607", amountMinor: 100, refundedMinor: 100, currency: "TWD", status: "refunded", productNameSnapshot: "Recorded product", buyerNameSnapshot: "=formula", buyerEmailSnapshot: "formula@example.test" },
    { id: ids[2], userId: ownerId, offerId, paymentProvider: "ecpay", providerOrderId: `owner-partial-${suffix}`.slice(0, 64), ecpayConnectionId: ownerConnectionId, merchantIdSnapshot: "3002607", amountMinor: 200, refundedMinor: 50, currency: "USD", status: "partially_refunded", productNameSnapshot: "Recorded product", buyerNameSnapshot: "Bob", buyerEmailSnapshot: "bob@example.test" },
    { id: ids[3], userId: ownerId, offerId, paymentProvider: "ecpay", providerOrderId: `owner-pending-${suffix}`.slice(0, 64), ecpayConnectionId: ownerConnectionId, merchantIdSnapshot: "3002607", amountMinor: 999, currency: "TWD", status: "pending", productNameSnapshot: "Recorded product", buyerNameSnapshot: "Pending", buyerEmailSnapshot: "pending@example.test" },
    { id: ids[4], userId: otherId, offerId: otherOfferId, paymentProvider: "ecpay", providerOrderId: `other-paid-${suffix}`.slice(0, 64), ecpayConnectionId: otherConnectionId, merchantIdSnapshot: "3002608", amountMinor: 1000, currency: "TWD", status: "paid", productNameSnapshot: "Other product", buyerNameSnapshot: "Other", buyerEmailSnapshot: "other@example.test" },
  ]);

  assert.equal((await call("/api/member/orders")).status, 401);
  const list = await call("/api/member/orders?pageSize=100", ownerId);
  assert.equal(list.status, 200);
  assert.equal((await list.json() as any).total, 4);
  assert.equal((await call(`/api/member/orders/${ids[0]}`, otherId)).status, 404);
  assert.equal((await call(`/api/member/orders/${ids[0]}`, rootId)).status, 404, "superadmin has no cross-member bypass");
  const filterOptions: any = await (await call("/api/member/orders/product-filters", ownerId)).json();
  assert.equal(filterOptions.truncated, false);
  assert.deepEqual(filterOptions.items.map((item: any) => item.id), [offerId]);

  const filtered = await call(`/api/member/orders?paymentStatus=refunded&productId=${offerId}`, ownerId);
  const filteredPayload: any = await filtered.json();
  assert.equal(filtered.status, 200);
  assert.deepEqual(filteredPayload.items.map((item: any) => item.id), [ids[1]]);
  const filteredSummary: any = await (await call(`/api/member/orders/summary?paymentStatus=refunded&productId=${offerId}`, ownerId)).json();
  assert.deepEqual(filteredSummary.currencies, [{
    currency: "TWD",
    counts: { pending: 0, paid: 0, failed: 0, partially_refunded: 0, refunded: 1 },
    paidGrossMinor: 100, refundedMinor: 100, netMinor: 0,
  }], "summary must use the same full filter dataset as list");
  const summaryResponse = await call("/api/member/orders/summary", ownerId);
  const summary: any = await summaryResponse.json();
  assert.equal(summaryResponse.status, 200);
  const twd = summary.currencies.find((item: any) => item.currency === "TWD");
  const usd = summary.currencies.find((item: any) => item.currency === "USD");
  assert.deepEqual(twd.counts, { pending: 1, paid: 1, failed: 0, partially_refunded: 0, refunded: 1 });
  assert.deepEqual({ gross: twd.paidGrossMinor, refund: twd.refundedMinor, net: twd.netMinor }, { gross: 200, refund: 100, net: 100 });
  assert.deepEqual({ gross: usd.paidGrossMinor, refund: usd.refundedMinor, net: usd.netMinor }, { gross: 200, refund: 50, net: 150 });

  assert.equal((await call(`/api/member/orders/${ids[0]}`, ownerId, "PATCH", {
    expectedVersion: 1, reason: "forbidden", status: "paid",
  })).status, 400);
  const updated = await call(`/api/member/orders/${ids[0]}`, ownerId, "PATCH", {
    expectedVersion: 1, reason: "Begin fulfillment", fulfillmentStatus: "in_progress", internalNote: "packed",
  });
  assert.equal(updated.status, 200);
  assert.equal((await updated.json() as any).version, 2);
  const stale = await call(`/api/member/orders/${ids[0]}`, ownerId, "PATCH", {
    expectedVersion: 1, reason: "stale", internalNote: "must not write",
  });
  assert.equal(stale.status, 409);
  const detail: any = await (await call(`/api/member/orders/${ids[0]}`, ownerId)).json();
  assert.equal(detail.events.some((event: any) => event.type === "fulfillment_changed"), true);
  assert.equal((await call(`/api/member/orders/${ids[1]}`, ownerId, "PATCH", {
    expectedVersion: 1, reason: "must not complete refund", fulfillmentStatus: "completed",
  })).status, 409);

  const exported = await call("/api/member/orders/export.csv", ownerId);
  const csv = await exported.text();
  assert.equal(exported.headers.get("x-export-truncated"), "false");
  assert.match(csv, /'=formula/);
  assert.doesNotMatch(csv, /Other product/);
});