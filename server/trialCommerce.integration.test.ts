import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "./db";
import { registerRoutes } from "./routes";
import {
  ecpayConnections,
  noCardTrials,
  offerSalesPages,
  trialCommerceLeads,
  trialCommercePages,
  trialCommerceViewEvents,
  users,
  webinarOffers,
} from "@shared/schema";
import { encryptEcpayCredential } from "./ecpay";

test("no-card trial commerce is one-page, branded lead capture, and resumes without ECPay", async (t) => {
  assert.notEqual(process.env.NODE_ENV, "production");
  const ownerId = crypto.randomUUID();
  const paidOwnerId = crypto.randomUUID();
  const slug = `trial-product-${crypto.randomUUID()}`;
  const paidSlug = `paid-product-${crypto.randomUUID()}`;
  const offerIds: string[] = [];
  const activeTrialStartsAt = new Date(Date.now() - 1_000);
  const activeTrialExpiresAt = new Date(activeTrialStartsAt.getTime() + 14 * 86_400_000);
  const activeTrialRetentionUntil = new Date(activeTrialExpiresAt.getTime() + 30 * 86_400_000);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = req.header("x-test-user");
    (req as any).session = userId ? { userId } : {};
    next();
  });
  const server = createServer(app);
  await registerRoutes(server, app, ((req: any, _res: any, next: () => void) => {
    req.session = req.headers["x-test-user"] ? { userId: req.headers["x-test-user"] } : {};
    next();
  }) as any, {
    startScheduler: () => {},
    refreshEntitlement: async () => { throw new Error("trial commerce must not contact Stripe"); },
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  async function request(path: string, method = "GET", body?: unknown, userId?: string) {
    return fetch(`${base}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(userId ? { "x-test-user": userId } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  async function json(response: Response, expected = 200) {
    const body = await response.json();
    assert.equal(response.status, expected, JSON.stringify(body));
    return body;
  }

  t.after(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await db.delete(trialCommerceViewEvents).where(inArray(trialCommerceViewEvents.ownerId, [ownerId, paidOwnerId]));
    await db.delete(trialCommerceLeads).where(inArray(trialCommerceLeads.ownerId, [ownerId, paidOwnerId]));
    await db.delete(trialCommercePages).where(inArray(trialCommercePages.ownerId, [ownerId, paidOwnerId]));
    if (offerIds.length) {
      await db.delete(offerSalesPages).where(inArray(offerSalesPages.offerId, offerIds));
      await db.delete(webinarOffers).where(inArray(webinarOffers.id, offerIds));
    }
    await db.delete(noCardTrials).where(eq(noCardTrials.userId, ownerId));
    await db.delete(ecpayConnections).where(inArray(ecpayConnections.userId, [ownerId, paidOwnerId]));
    await db.delete(users).where(inArray(users.id, [ownerId, paidOwnerId]));
    await pool.end();
  });

  await db.insert(users).values([
    {
      id: ownerId,
      username: `trial-commerce-${ownerId}`,
      password: "not-a-login-hash",
      subscriptionPlan: "free",
      subscriptionStatus: "inactive",
    },
    {
      id: paidOwnerId,
      username: `paid-commerce-${paidOwnerId}`,
      password: "not-a-login-hash",
      subscriptionPlan: "starter",
      subscriptionStatus: "active",
      planExpiresAt: new Date(Date.now() + 86_400_000),
    },
  ]);
  await db.insert(noCardTrials).values({
    userId: ownerId,
    startsAt: activeTrialStartsAt,
    expiresAt: activeTrialExpiresAt,
    retentionUntil: activeTrialRetentionUntil,
  });
  // The narrow backend gate preserves ordinary workbench list/draft access
  // while denying advanced analytics, external reporting, and embed paths.
  assert.equal((await request("/api/webinars", "GET", undefined, ownerId)).status, 200);
  assert.equal((await request(`/api/webinars/${crypto.randomUUID()}/analytics`, "GET", undefined, ownerId)).status, 403);
  assert.equal((await request("/api/member/external-orders", "GET", undefined, ownerId)).status, 403);
  assert.equal((await request(`/embed/register/${crypto.randomUUID()}`, "GET", undefined, ownerId)).status, 403);

  const first = await json(await request("/api/products", "POST", { name: "Trial product", amountTwd: 320 }, ownerId), 201);
  const second = await json(await request("/api/products", "POST", { name: "Second product", amountTwd: 420 }, ownerId), 201);
  offerIds.push(first.id, second.id);
  const create = (offerId: string, pageSlug: string) => request("/api/product-sales-pages", "POST", {
    offerId,
    slug: pageSlug,
    title: "Trial lead page",
  }, ownerId);
  const [firstCreate, secondCreate] = await Promise.all([
    create(first.id, slug),
    create(second.id, `${slug}-second`),
  ]);
  const created = [firstCreate, secondCreate].find(response => response.status === 201);
  const rejected = [firstCreate, secondCreate].find(response => response.status === 409);
  assert.ok(created, "one concurrent editor creation must win");
  assert.ok(rejected, "the other concurrent editor creation must be fenced");
  const page = await json(created!, 201);
  const rejectedBody = await rejected!.json();
  assert.equal(rejectedBody.code, "TRIAL_PRODUCT_PAGE_LIMIT");

  // Publication itself is optimistic-concurrency guarded and needs no ECPay
  // connection because the trial page is lead generation only.
  const [publishA, publishB] = await Promise.all([
    request(`/api/product-sales-pages/${page.id}/publish`, "POST", { version: page.version }, ownerId),
    request(`/api/product-sales-pages/${page.id}/publish`, "POST", { version: page.version }, ownerId),
  ]);
  const publishedResponse = [publishA, publishB].find(response => response.status === 200);
  assert.ok(publishedResponse);
  assert.ok([publishA.status, publishB.status].includes(409));
  const published = await json(publishedResponse!);

  const publicPage = await json(await request(`/api/sales-pages/${slug}`));
  assert.equal(publicPage.offer.paymentProvider, "lead_capture");
  assert.equal(publicPage.offer.checkoutMode, "lead_capture");
  assert.equal(publicPage.brand.poweredBy, "Powered by SellCase 開賣啦");
  assert.equal(publicPage.leadCapture.consentRequired, true);
  assert.equal(publicPage.platformUrl, `/sales/${slug}`);
  // An active no-card trial cannot turn the normal checkout endpoint into a
  // provider request or use an unrelated paid page through global entitlement.
  assert.equal((await request(`/api/products/${first.id}/checkout`, "POST", {
    salesPageId: page.id,
    buyer: { name: "Buyer", email: "buyer@example.test" },
  })).status, 409);
  assert.equal((await request(`/api/products/${first.id}/events`, "POST", {
    eventType: "landing_view",
    pageId: page.id,
    visitorToken: crypto.randomUUID().replace(/-/g, ""),
    dedupeKey: "generic-trial-event",
  })).status, 409);
  assert.equal((await request(`/api/sales-pages/${slug}/checkout`, "POST", {})).status, 409);
  assert.equal((await request(`/api/sales-pages/${slug}/events`, "POST", {})).status, 409);

  assert.equal((await request(publicPage.leadCapture.endpoint, "POST", {
    name: "Lead",
    email: "LEAD@Example.test",
    consent: true,
  })).status, 201);
  assert.equal((await request(publicPage.leadCapture.endpoint, "POST", {
    name: "Changed display name",
    email: "lead@example.test",
    consent: true,
  })).status, 200);
  const eventPath = `/api/trial-commerce/sales-pages/${slug}/events`;
  const visitorOne = crypto.randomUUID().replace(/-/g, "");
  const visitorTwo = crypto.randomUUID().replace(/-/g, "");
  assert.equal((await request(eventPath, "POST", { visitorToken: visitorOne, dedupeKey: "view-one-unique" })).status, 202);
  assert.equal((await request(eventPath, "POST", { visitorToken: visitorOne, dedupeKey: "view-one-unique" })).status, 200);
  assert.equal((await request(eventPath, "POST", { visitorToken: visitorTwo, dedupeKey: "view-two-unique" })).status, 202);
  const leads = await json(await request("/api/trial-commerce/leads?page=1&pageSize=25", "GET", undefined, ownerId));
  assert.equal(leads.total, 1);
  assert.equal(leads.items[0].email, "lead@example.test");
  assert.deepEqual(await json(await request("/api/trial-commerce/stats", "GET", undefined, ownerId)), {
    visitors: 2, leads: 1, conversion: 50,
  });

  // A paid upgrade takes priority before the no-card record expires. With no
  // merchant it remains a working lead form; verified merchant setup switches
  // immediately to the established paid checkout DTO.
  await db.update(users).set({
    subscriptionPlan: "starter",
    subscriptionStatus: "active",
    planExpiresAt: new Date(Date.now() + 86_400_000),
  }).where(eq(users.id, ownerId));
  const earlyPaidLead = await json(await request(`/api/sales-pages/${slug}`));
  assert.equal(earlyPaidLead.offer.paymentProvider, "lead_capture");
  assert.equal(earlyPaidLead.trialBrandingRequired, false);
  await db.insert(ecpayConnections).values({
    userId: ownerId,
    merchantId: "3002607",
    environment: "stage",
    enabled: true,
    verifiedAt: new Date(),
    hashKeyEncrypted: encryptEcpayCredential("0123456789abcdef0123456789abcdef", "trial-commerce-test-secret"),
    hashIvEncrypted: encryptEcpayCredential("0123456789abcdef", "trial-commerce-test-secret"),
  });
  assert.equal((await json(await request(`/api/sales-pages/${slug}`))).offer.paymentProvider, "ecpay");
  await db.delete(ecpayConnections).where(eq(ecpayConnections.userId, ownerId));
  await db.update(users).set({
    subscriptionPlan: "free",
    subscriptionStatus: "inactive",
    planExpiresAt: null,
  }).where(eq(users.id, ownerId));

  const expiredTrialStartsAt = new Date(Date.now() - 15 * 86_400_000);
  const expiredTrialExpiresAt = new Date(expiredTrialStartsAt.getTime() + 14 * 86_400_000);
  await db.update(noCardTrials).set({
    startsAt: expiredTrialStartsAt,
    expiresAt: expiredTrialExpiresAt,
    retentionUntil: new Date(expiredTrialExpiresAt.getTime() + 30 * 86_400_000),
  })
    .where(eq(noCardTrials.userId, ownerId));
  const paused = await request(`/api/sales-pages/${slug}`);
  assert.equal(paused.status, 410);
  assert.equal((await paused.json()).code, "TRIAL_EXPIRED");
  assert.equal((await request(publicPage.leadCapture.endpoint, "POST", {
    name: "Late lead", email: "late@example.test", consent: true,
  })).status, 410);

  // A paid upgrade restores the original URL and immutable snapshot. Because
  // no merchant payment has been configured, it correctly remains lead capture.
  await db.update(users).set({
    subscriptionPlan: "starter",
    subscriptionStatus: "active",
    planExpiresAt: new Date(Date.now() + 86_400_000),
  }).where(eq(users.id, ownerId));
  const resumed = await json(await request(`/api/sales-pages/${slug}`));
  assert.equal(resumed.id, page.id);
  assert.equal(resumed.publishedAt, published.publishedAt);
  assert.equal(resumed.offer.paymentProvider, "lead_capture");
  assert.equal(resumed.brand.poweredBy, "Powered by SellCase 開賣啦");
  assert.equal(resumed.trialBrandingRequired, false);

  // Explicit verified merchant setup is the only transition to the normal
  // paid DTO. No request is made to ECPay in this test.
  await db.insert(ecpayConnections).values({
    userId: ownerId,
    merchantId: "3002607",
    environment: "stage",
    enabled: true,
    verifiedAt: new Date(),
    hashKeyEncrypted: encryptEcpayCredential("0123456789abcdef0123456789abcdef", "trial-commerce-test-secret"),
    hashIvEncrypted: encryptEcpayCredential("0123456789abcdef", "trial-commerce-test-secret"),
  });
  const paidCheckoutPage = await json(await request(`/api/sales-pages/${slug}`));
  assert.equal(paidCheckoutPage.offer.paymentProvider, "ecpay");
  assert.equal(paidCheckoutPage.brand, undefined);

  // A normal paid sales page has no trial tracker and remains on the original
  // payment DTO, proving trial handling did not alter existing commerce.
  const paidOffer = await json(await request("/api/products", "POST", { name: "Paid product", amountTwd: 880 }, paidOwnerId), 201);
  offerIds.push(paidOffer.id);
  const paidPage = await json(await request("/api/product-sales-pages", "POST", {
    offerId: paidOffer.id, slug: paidSlug, title: "Paid page",
  }, paidOwnerId), 201);
  await json(await request(`/api/product-sales-pages/${paidPage.id}/publish`, "POST", { version: paidPage.version }, paidOwnerId));
  const ordinary = await json(await request(`/api/sales-pages/${paidSlug}`));
  assert.equal(ordinary.offer.paymentProvider, "ecpay");
  assert.equal(ordinary.brand, undefined);
});