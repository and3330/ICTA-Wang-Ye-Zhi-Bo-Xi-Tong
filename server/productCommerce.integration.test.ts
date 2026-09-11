import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import express from "express";
import { createServer } from "node:http";
import { WebSocket } from "ws";
import { and, eq, inArray } from "drizzle-orm";
import { db, pool } from "./db";
import { registerRoutes } from "./routes";
import {
  users, webinars, webinarOffers, offerSalesPages, webinarPayments,
  webinarFunnelEvents, ctaButtons, ecpayConnections, memberOrderEvents,
} from "@shared/schema";
import { createCheckMacValue, encryptEcpayCredential } from "./ecpay";

// Uses the development/test database and synthetic merchants only. No request
// is sent to ECPay or Stripe; signed callbacks exercise the real HTTP handler.
test("standalone commerce: zero-webinar lifecycle, tenant isolation, signed payment and CTA sources", async (t) => {
  assert.notEqual(process.env.NODE_ENV, "production");
  const ownerId = crypto.randomUUID();
  const otherId = crypto.randomUUID();
  const webinarId = crypto.randomUUID();
  const offerIds: string[] = [];
  const merchantId = "3002607";
  const hashKey = "0123456789abcdef0123456789abcdef";
  const hashIv = "0123456789abcdef";
  const slug = `test-product-${crypto.randomUUID()}`;
  const block = { id: "offer", type: "offer", enabled: true, headline: "原始商品內容", buttonLabel: "立即購買" };
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use((req, _res, next) => {
    const id = req.header("x-test-user");
    (req as any).session = id ? { userId: id } : {};
    next();
  });
  const server = createServer(app);
  let hostSocket: WebSocket | undefined;
  await registerRoutes(server, app, ((req: any, _res: any, next: () => void) => {
    req.session = { userId: req.headers["x-test-user"] };
    next();
  }) as any, {
    startScheduler: () => {},
    refreshEntitlement: async () => { throw new Error("Commerce must not contact Stripe during this test"); },
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  async function request(path: string, method = "GET", body?: unknown, actor?: string) {
    return fetch(`${base}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(actor ? { "x-test-user": actor } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  async function jsonOk(response: Response, status = 200) {
    const json = await response.json();
    assert.equal(response.status, status, JSON.stringify(json));
    return json;
  }
  t.after(async () => {
    hostSocket?.terminate();
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (offerIds.length) {
      await db.delete(webinarFunnelEvents).where(inArray(webinarFunnelEvents.offerId, offerIds));
      const paymentIds = await db.select({ id: webinarPayments.id }).from(webinarPayments)
        .where(inArray(webinarPayments.offerId, offerIds));
      if (paymentIds.length) {
        await db.delete(memberOrderEvents).where(inArray(memberOrderEvents.paymentId, paymentIds.map(row => row.id)));
      }
      await db.delete(webinarPayments).where(inArray(webinarPayments.offerId, offerIds));
    }
    await db.delete(ctaButtons).where(eq(ctaButtons.webinarId, webinarId));
    if (offerIds.length) {
      await db.delete(offerSalesPages).where(inArray(offerSalesPages.offerId, offerIds));
      await db.delete(webinarOffers).where(inArray(webinarOffers.id, offerIds));
    }
    await db.delete(webinars).where(eq(webinars.id, webinarId));
    await db.delete(ecpayConnections).where(eq(ecpayConnections.userId, ownerId));
    await db.delete(users).where(inArray(users.id, [ownerId, otherId]));
    await pool.end();
  });
  await db.insert(users).values([
    { id: ownerId, username: `product-test-${ownerId}`, password: "not-a-login-hash", subscriptionPlan: "free", subscriptionStatus: "inactive" },
    { id: otherId, username: `product-test-${otherId}`, password: "not-a-login-hash", subscriptionPlan: "starter", subscriptionStatus: "active" },
  ]);

  assert.equal((await request("/api/products")).status, 401);
  assert.equal((await request("/api/products", "POST", { name: "拒絕無效價格", amountTwd: -1 }, ownerId)).status, 400);
  const product = await jsonOk(await request("/api/products", "POST", { name: "獨立商品", amountTwd: 880 }, ownerId), 201);
  offerIds.push(product.id);
  assert.equal(product.webinarId, null);
  assert.equal((await db.select().from(webinars).where(eq(webinars.userId, ownerId))).length, 0);
  const other = await jsonOk(await request("/api/products", "POST", { name: "其他會員商品", amountTwd: 120 }, otherId), 201);
  offerIds.push(other.id);
  const freeProduct = await jsonOk(await request("/api/products", "POST", { name: "免費版型商品", amountTwd: 360 }, ownerId), 201);
  offerIds.push(freeProduct.id);
  const owned = await jsonOk(await request("/api/products", "GET", undefined, ownerId));
  assert.deepEqual(new Set(owned.map((item: any) => item.id)), new Set([product.id, freeProduct.id]));
  assert.ok([403, 404].includes((await request(`/api/products/${product.id}`, "PATCH", { amountTwd: 1 }, otherId)).status));
  assert.ok([403, 404].includes((await request(`/api/products/${product.id}/orders`, "GET", undefined, otherId)).status));
  assert.ok([400, 403, 404].includes((await request("/api/product-sales-pages", "POST", {
    offerId: product.id, slug: `${slug}-stolen`, title: "Cross tenant", blocks: [block],
  }, otherId)).status));

  const freePage = await jsonOk(await request("/api/product-sales-pages", "POST", {
    offerId: freeProduct.id, slug: `${slug}-free`, title: "免費版型商品", template: "free",
  }, ownerId), 201);
  assert.deepEqual(freePage.orderedBlocks.map((item: any) => item.type), ["hero", "benefits", "offer", "faq"]);
  assert.equal(freePage.orderedBlocks[0].headline, "讓「免費版型商品」帶你走得更遠");
  assert.equal(freePage.orderedBlocks[2].layout, undefined);

  let page = await jsonOk(await request("/api/product-sales-pages", "POST", {
    offerId: product.id, slug, title: "獨立成交頁",
    checkoutSettings: { successTitle: "原始付款成功文案", successButtonUrl: "https://example.test/original-delivery" },
  }, ownerId), 201);
  assert.equal(page.orderedBlocks[0].type, "offer");
  assert.equal(page.orderedBlocks[0].layout, "ecommerce");
  assert.deepEqual(page.orderedBlocks[0].images, []);
  assert.equal(page.orderedBlocks.some((item: any) => item.type === "testimonials"), false);
  assert.equal((await request(`/api/sales-pages/${slug}`)).status, 404);
  assert.ok([403, 409].includes((await request(`/api/product-sales-pages/${page.id}/publish`, "POST", { version: page.version }, ownerId)).status));
  await db.update(users).set({
    subscriptionPlan: "starter", subscriptionStatus: "trialing",
    planExpiresAt: new Date(Date.now() + 86_400_000),
  }).where(eq(users.id, ownerId));
  await db.insert(ecpayConnections).values({
    userId: ownerId, merchantId, environment: "stage", enabled: true, verifiedAt: new Date(),
    hashKeyEncrypted: encryptEcpayCredential(hashKey), hashIvEncrypted: encryptEcpayCredential(hashIv),
  });
  page = await jsonOk(await request(`/api/product-sales-pages/${page.id}/publish`, "POST", { version: page.version }, ownerId));
  let publicPage = await jsonOk(await request(`/api/sales-pages/${slug}`));
  assert.equal(publicPage.webinarId, null);
  assert.equal(publicPage.offer.amountMinor, 88000);
  assert.equal(publicPage.blocks[0].headline, "獨立成交頁");
  assert.equal(publicPage.blocks[0].layout, "ecommerce");
  assert.deepEqual(publicPage.blocks[0].images, []);
  assert.equal(publicPage.checkoutSettings?.successButtonUrl, undefined);
  assert.equal((await request(`/api/product-sales-pages/${page.id}`, "PATCH", {
    version: page.version - 1 || 999, title: "Stale overwrite",
  }, ownerId)).status, 409);
  const ecommerceDraftOffer = {
    ...page.orderedBlocks[0],
    headline: "尚未發布的商品草稿",
    images: [{ url: "https://cdn.example.test/product.webp", alt: "商品正面" }],
    summary: "只有草稿目前看得到的新商品摘要。",
    features: ["由 API 商品價格決定結帳金額", "安全交付"],
  };
  assert.equal((await request(`/api/product-sales-pages/${page.id}`, "PATCH", {
    version: page.version,
    blocks: [{ ...ecommerceDraftOffer, amountMinor: 1 }, ...page.orderedBlocks.slice(1)],
  }, ownerId)).status, 400);
  page = await jsonOk(await request(`/api/product-sales-pages/${page.id}`, "PATCH", {
    version: page.version, title: page.title, slug: page.slug,
    blocks: [ecommerceDraftOffer, ...page.orderedBlocks.slice(1)],
    checkoutSettings: { successTitle: "新的付款文案", successButtonUrl: "https://example.test/new-delivery" },
  }, ownerId));
  assert.deepEqual(page.orderedBlocks[0].images, ecommerceDraftOffer.images);
  assert.equal(page.orderedBlocks[0].summary, ecommerceDraftOffer.summary);
  publicPage = await jsonOk(await request(`/api/sales-pages/${slug}`));
  assert.equal(publicPage.blocks[0].headline, "獨立成交頁");
  assert.deepEqual(publicPage.blocks[0].images, []);
  assert.equal(publicPage.offer.amountMinor, 88000);

  const checkoutBody = {
    salesPageId: page.id,
    sessionId: `buyer-${crypto.randomUUID()}`,
    buyer: { name: "Checkout Buyer", email: `buyer-${crypto.randomUUID()}@example.test` },
  };
  assert.ok([400, 404, 409].includes((await request(`/api/products/${other.id}/checkout`, "POST", checkoutBody)).status));
  assert.equal((await request(`/api/products/${product.id}/checkout`, "POST", { ...checkoutBody, amountTwd: 1 })).status, 400);
  const checkout = await jsonOk(await request(`/api/products/${product.id}/checkout`, "POST", checkoutBody));
  assert.equal(checkout.provider, "ecpay");
  assert.match(checkout.action, /^https:\/\/payment-stage\.ecpay\.com\.tw\//);
  assert.equal(Number(checkout.fields.TotalAmount), 880);
  const tradeNo = checkout.fields.MerchantTradeNo as string;
  const token = new URL(checkout.fields.ClientBackURL).searchParams.get("t");
  assert.ok(token);
  let [payment] = await db.select().from(webinarPayments).where(eq(webinarPayments.providerOrderId, tradeNo));
  assert.equal(payment.status, "pending");
  assert.equal(payment.webinarId, null);
  assert.equal(payment.registrationId, null);
  assert.equal(payment.productNameSnapshot, "獨立商品");
  assert.equal(payment.buyerNameSnapshot, "Checkout Buyer");
  const statusPath = `/api/public/checkout-status?provider=ecpay&status_token=${token}`;
  assert.equal((await jsonOk(await request(`${statusPath}&status=paid`))).status, "pending");
  assert.notEqual((await request("/api/public/checkout-status?provider=ecpay&status_token=invalid")).status, 200);
  await jsonOk(await request(`/api/products/${product.id}`, "PATCH", { name: "已改價商品", amountTwd: 999 }, ownerId));
  const callbackFields: Record<string, string> = {
    MerchantID: merchantId, MerchantTradeNo: tradeNo, TradeAmt: "880",
    RtnCode: "1", RtnMsg: "Succeeded", SimulatePaid: "0",
  };
  const callback = async (fields: Record<string, string>) => fetch(`${base}/api/ecpay/return`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...fields, CheckMacValue: createCheckMacValue(fields, hashKey, hashIv) }),
  });
  assert.equal((await callback({ ...callbackFields, TradeAmt: "1" })).status, 400);
  const delivered = await Promise.all([callback(callbackFields), callback(callbackFields)]);
  for (const response of delivered) assert.equal(await response.text(), "1|OK");
  [payment] = await db.select().from(webinarPayments).where(eq(webinarPayments.providerOrderId, tradeNo));
  assert.equal(payment.status, "paid");
  assert.equal(payment.operationVersion, 2, "verified payment transition invalidates stale member operations");
  // Authenticated terminal failure is recorded, an authoritative later success
  // recovers it, and a reordered failure can never downgrade a paid order.
  const retryCheckout = await jsonOk(await request(`/api/products/${product.id}/checkout`, "POST", checkoutBody));
  const retryTradeNo = retryCheckout.fields.MerchantTradeNo as string;
  const retryFailure = {
    MerchantID: merchantId, MerchantTradeNo: retryTradeNo, TradeAmt: "999",
    RtnCode: "0", RtnMsg: "Failed", SimulatePaid: "0",
  };
  const retryWaiting = { ...retryFailure, RtnCode: "2", RtnMsg: "Awaiting confirmation" };
  assert.equal(await (await callback(retryWaiting)).text(), "1|OK");
  let [retryPayment] = await db.select().from(webinarPayments).where(eq(webinarPayments.providerOrderId, retryTradeNo));
  assert.equal(retryPayment.status, "pending");
  assert.equal(retryPayment.operationVersion, 2);
  assert.equal(await (await callback(retryWaiting)).text(), "1|OK");
  [retryPayment] = await db.select().from(webinarPayments).where(eq(webinarPayments.providerOrderId, retryTradeNo));
  assert.equal(retryPayment.operationVersion, 2, "identical authenticated waiting callbacks do not duplicate visible state");
  assert.equal(await (await callback(retryFailure)).text(), "1|OK");
  [retryPayment] = await db.select().from(webinarPayments).where(eq(webinarPayments.providerOrderId, retryTradeNo));
  assert.equal(retryPayment.status, "failed");
  assert.equal(retryPayment.operationVersion, 3);
  assert.equal(await (await callback({ ...retryFailure, RtnCode: "1", RtnMsg: "Succeeded" })).text(), "1|OK");
  [retryPayment] = await db.select().from(webinarPayments).where(eq(webinarPayments.providerOrderId, retryTradeNo));
  assert.equal(retryPayment.status, "paid");
  assert.equal(retryPayment.operationVersion, 4);
  assert.equal(await (await callback(retryFailure)).text(), "1|OK");
  [retryPayment] = await db.select().from(webinarPayments).where(eq(webinarPayments.providerOrderId, retryTradeNo));
  assert.equal(retryPayment.status, "paid");
  assert.equal(retryPayment.operationVersion, 5, "new evidence is visible without downgrading paid status");
  const purchases = await db.select().from(webinarFunnelEvents).where(and(
    eq(webinarFunnelEvents.offerId, product.id), eq(webinarFunnelEvents.eventType, "purchase"),
  ));
  assert.equal(purchases.length, 2, "two distinct verified orders produce two purchases; callback replay does not add a third");
  const status = await jsonOk(await request(statusPath));
  assert.equal(status.status, "paid");
  assert.equal(status.checkoutSettings.successButtonUrl, "https://example.test/original-delivery");
  const orders = await jsonOk(await request(`/api/products/${product.id}/orders`, "GET", undefined, ownerId));
  assert.equal(orders[0].source, "direct");
  assert.equal(orders.some((order: any) => order.amountMinor === 88000), true, "earlier checkout retains its immutable amount");
  for (const key of ["providerHashKeySnapshot", "providerHashIvSnapshot", "checkoutStatusTokenHash"]) {
    assert.equal(orders[0][key], undefined, `${key} must not be exposed`);
  }
  page = await jsonOk(await request(`/api/product-sales-pages/${page.id}/publish`, "POST", { version: page.version }, ownerId));
  publicPage = await jsonOk(await request(`/api/sales-pages/${slug}`));
  assert.equal(publicPage.blocks[0].headline, "尚未發布的商品草稿");
  assert.deepEqual(publicPage.blocks[0].images, ecommerceDraftOffer.images);
  assert.equal(publicPage.blocks[0].summary, ecommerceDraftOffer.summary);
  assert.deepEqual(publicPage.blocks[0].features, ecommerceDraftOffer.features);
  assert.equal(publicPage.offer.amountMinor, 99900);
  assert.equal((await jsonOk(await request(statusPath))).checkoutSettings.successButtonUrl, "https://example.test/original-delivery");

  await db.insert(webinars).values({
    id: webinarId, userId: ownerId, title: "Optional source webinar", vimeoUrl: "https://vimeo.com/123456789",
    startTime: new Date(Date.now() + 86_400_000), publishStatus: "published",
  });
  const cta = await jsonOk(await request(`/api/webinars/${webinarId}/ctas`, "POST", {
    text: "看商品頁", salesPageId: page.id, startTime: 0,
  }, ownerId), 201);
  assert.equal(cta.salesPageId, page.id);
  assert.equal(cta.offerId, null);
  const ctaList = await jsonOk(await request(`/api/webinars/${webinarId}/ctas`, "GET", undefined, ownerId));
  const pageCta = ctaList.find((item: any) => item.id === cta.id);
  assert.ok(pageCta.url, "page CTA must include a validated navigable URL");
  const redirected = await fetch(new URL(pageCta.url, base), { redirect: "manual" });
  assert.equal(redirected.status, 302);
  const destination = new URL(redirected.headers.get("location")!, base);
  assert.equal(destination.pathname, `/sales/${slug}`);
  assert.equal(destination.searchParams.get("sourceCtaId"), cta.id);
  assert.equal(destination.searchParams.get("sourceWebinarId"), webinarId);
  hostSocket = new WebSocket(`${base.replace("http:", "ws:")}/ws`, { headers: { "x-test-user": ownerId } });
  await new Promise<void>((resolve, reject) => {
    hostSocket!.once("open", resolve);
    hostSocket!.once("error", reject);
  });
  async function wsAction(type: string, data: object, responseType: string) {
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        hostSocket!.off("message", listener);
        reject(new Error(`No ${responseType} received for ${type}`));
      }, 5000);
      const listener = (raw: Buffer) => {
        const message = JSON.parse(raw.toString());
        if (message.type !== responseType && message.type !== "error") return;
        clearTimeout(timer);
        hostSocket!.off("message", listener);
        if (message.type === "error") reject(new Error(message.data.message));
        else resolve(message.data);
      };
      hostSocket!.on("message", listener);
      hostSocket!.send(JSON.stringify({ type, data }));
    });
  }
  await wsAction("joinAsHost", { webinarId }, "history");
  const livePage = await wsAction("liveCta", { text: "即時商品頁", salesPageId: page.id, durationSec: 120 }, "liveCta");
  assert.match(livePage.id, /^[0-9a-f-]{36}$/);
  assert.equal(livePage.offerId, null);
  const liveRedirect = await fetch(new URL(livePage.url, base), { redirect: "manual" });
  assert.equal(liveRedirect.status, 302);
  assert.equal(new URL(liveRedirect.headers.get("location")!, base).searchParams.get("sourceCtaId"), livePage.id);
  const liveDirect = await wsAction("liveCta", { text: "即時購買", offerId: product.id, durationSec: 120 }, "liveCta");
  assert.equal(liveDirect.offerId, product.id);
  await jsonOk(await request(`/api/webinars/${webinarId}/offer-checkout`, "POST", {
    ctaId: liveDirect.id, sessionId: checkoutBody.sessionId, buyer: checkoutBody.buyer,
  }));
  const scheduledOnly = await jsonOk(await request(`/api/webinars/${webinarId}/ctas`, "GET", undefined, ownerId));
  assert.equal(scheduledOnly.some((item: any) => item.id === liveDirect.id || item.id === livePage.id), false);
  hostSocket.close();
  assert.ok([400, 403, 404].includes((await request(`/api/webinars/${webinarId}/ctas`, "POST", {
    text: "Cross member", offerId: other.id, startTime: 0,
  }, ownerId)).status));
  const sourced = await jsonOk(await request(`/api/products/${product.id}/checkout`, "POST", {
    ...checkoutBody, sourceCtaId: cta.id, sourceWebinarId: webinarId,
  }));
  const [sourcedOrder] = await db.select().from(webinarPayments).where(eq(webinarPayments.providerOrderId, sourced.fields.MerchantTradeNo));
  assert.equal(sourcedOrder.webinarId, webinarId);
  assert.equal(sourcedOrder.ctaId, cta.id);
  assert.ok([400, 403, 404].includes((await request(`/api/products/${other.id}/checkout`, "POST", {
    ...checkoutBody, sourceCtaId: cta.id, sourceWebinarId: webinarId,
  })).status));
  assert.equal((await request(`/api/products/${product.id}/events`, "POST", {
    eventType: "purchase", pageId: page.id, amountMinor: 999999,
    visitorToken: crypto.randomUUID(), dedupeKey: crypto.randomUUID(),
  })).status, 400);
  // Emulate schema-only publication of historical rows: no data backfill has
  // populated the new owner columns, and the original webinar is now deleted.
  await db.update(webinarOffers).set({ userId: null, webinarId }).where(eq(webinarOffers.id, product.id));
  await db.update(offerSalesPages).set({ userId: null, webinarId }).where(eq(offerSalesPages.id, page.id));
  await db.update(webinarPayments).set({ userId: null }).where(eq(webinarPayments.id, payment.id));
  await db.update(webinars).set({ deletedAt: new Date(), publishStatus: "draft" }).where(eq(webinars.id, webinarId));
  assert.equal((await request(`/api/sales-pages/${slug}`)).status, 200);
  assert.equal(
    (await jsonOk(await request("/api/products", "GET", undefined, ownerId))).some((item: any) => item.id === product.id),
    true,
  );
  await jsonOk(await request(`/api/products/${product.id}/checkout`, "POST", checkoutBody));
  await db.update(users).set({ planExpiresAt: new Date(Date.now() - 1000) }).where(eq(users.id, ownerId));
  assert.equal((await request(`/api/sales-pages/${slug}`)).status, 404);
  assert.ok([403, 404].includes((await request(`/api/products/${product.id}/checkout`, "POST", checkoutBody)).status));
  assert.equal((await jsonOk(await request(statusPath))).status, "paid");
  await db.update(users).set({ planExpiresAt: new Date(Date.now() + 86_400_000) }).where(eq(users.id, ownerId));
  page = await jsonOk(await request(`/api/product-sales-pages/${page.id}/unpublish`, "POST", { version: page.version }, ownerId));
  assert.equal((await request(`/api/sales-pages/${slug}`)).status, 404);
  assert.equal((await request(`/api/products/${product.id}/checkout`, "POST", checkoutBody)).status, 404);
  await jsonOk(await request(`/api/products/${product.id}`, "DELETE", undefined, ownerId));
  const afterArchive = await jsonOk(await request("/api/products", "GET", undefined, ownerId));
  assert.equal(afterArchive.find((item: any) => item.id === product.id).active, false);
  assert.equal((await jsonOk(await request(`/api/products/${product.id}/orders`, "GET", undefined, ownerId))).length, 5);
  assert.equal((await jsonOk(await request(statusPath))).status, "paid");
  const archivedPaymentCallback = { ...callbackFields, MerchantTradeNo: sourced.fields.MerchantTradeNo, TradeAmt: "999" };
  assert.equal(await (await callback(archivedPaymentCallback)).text(), "1|OK");
  const restored = await jsonOk(await request(`/api/products/${product.id}`, "PATCH", { active: true }, ownerId));
  assert.equal(restored.active, true);
});