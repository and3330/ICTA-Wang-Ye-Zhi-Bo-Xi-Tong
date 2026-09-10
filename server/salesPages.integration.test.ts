import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createServer } from "node:http";
import crypto from "node:crypto";
import { OFFER_CHECKOUT_RATE_LIMIT, registerRoutes } from "./routes";
import { storage } from "./storage";
import type { OfferSalesPage, Webinar, WebinarOffer } from "@shared/schema";

test("sales page HTTP routes enforce ownership, webinar offer scope, visibility, and publishing rules", async (t) => {
  const ownerId = "sales-page-owner";
  const webinarId = "webinar-owned";
  const pageId = "page-owned";
  const offerId = "7780bedb-f243-4f24-98ef-d97d0107ca42";
  const ownedOfferId = "6680bedb-f243-4f24-98ef-d97d0107ca42";
  const webinar = {
    id: webinarId, userId: ownerId, publishStatus: "draft", title: "Draft webinar",
  } as Webinar;
  const page = {
    id: pageId,
    webinarId,
    offerId,
    slug: "member-offer",
    title: "Member offer",
    status: "draft",
    orderedBlocks: [{
      id: "offer-main", type: "offer", enabled: true, headline: "Join", buttonLabel: "Buy",
    }],
    version: 1,
  } as OfferSalesPage;
  const crossWebinarOffer = {
    id: offerId, webinarId: "another-webinar", active: true, paymentProvider: "ecpay",
  } as WebinarOffer;
  const ownedOffer = {
    id: ownedOfferId, webinarId, userId: ownerId, active: true, paymentProvider: "ecpay",
  } as WebinarOffer;
  let statusMutationCalled = false;
  let createdInput: any;

  const originals = {
    getWebinar: storage.getWebinar,
    getWebinarOffer: storage.getWebinarOffer,
    getOfferSalesPage: storage.getOfferSalesPage,
    getPublicOfferSalesPage: storage.getPublicOfferSalesPage,
    createOfferSalesPage: storage.createOfferSalesPage,
    setOfferSalesPageStatus: storage.setOfferSalesPageStatus,
  };
  storage.getWebinar = async id => id === webinarId ? webinar : undefined;
  storage.getWebinarOffer = async id => id === offerId
    ? crossWebinarOffer
    : id === ownedOfferId
      ? ownedOffer
      : undefined;
  storage.getOfferSalesPage = async (requestedWebinar, requestedPage) =>
    requestedWebinar === webinarId && requestedPage === pageId ? page : undefined;
  storage.getPublicOfferSalesPage = async () => undefined;
  storage.createOfferSalesPage = async input => {
    if (input.offerId !== ownedOfferId) throw new Error("cross-webinar offer must not be inserted");
    createdInput = input;
    return {
      ...page,
      id: "created-default-template",
      offerId: ownedOfferId,
      slug: input.slug,
      title: input.title,
      orderedBlocks: input.orderedBlocks,
    } as OfferSalesPage;
  };
  storage.setOfferSalesPageStatus = async () => {
    statusMutationCalled = true;
    return page;
  };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = req.header("x-test-user-id");
    (req as any).session = userId ? { userId } : {};
    next();
  });
  const server = createServer(app);
  await registerRoutes(server, app, undefined, { startScheduler: () => {} });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  t.after(async () => {
    Object.assign(storage, originals);
    await new Promise<void>((resolve, reject) =>
      server.close(error => error ? reject(error) : resolve()));
  });

  const anonymousOwnerRead = await fetch(`${baseUrl}/api/webinars/${webinarId}/sales-pages/${pageId}`);
  assert.equal(anonymousOwnerRead.status, 401);

  const defaultTemplateCreate = await fetch(`${baseUrl}/api/webinars/${webinarId}/sales-pages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-test-user-id": ownerId },
    body: JSON.stringify({ offerId: ownedOfferId, slug: "default-template", title: "HTTP template" }),
  });
  assert.equal(defaultTemplateCreate.status, 201, await defaultTemplateCreate.text());
  assert.equal(createdInput.orderedBlocks[0].type, "offer");
  assert.equal(createdInput.orderedBlocks[0].layout, "ecommerce");
  assert.deepEqual(createdInput.orderedBlocks[0].images, []);

  const crossOfferCreate = await fetch(`${baseUrl}/api/webinars/${webinarId}/sales-pages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-test-user-id": ownerId },
    body: JSON.stringify({ offerId, slug: "member-offer", title: "Member offer" }),
  });
  assert.equal(crossOfferCreate.status, 400);

  const hiddenPublicPage = await fetch(`${baseUrl}/api/sales-pages/member-offer`);
  assert.equal(hiddenPublicPage.status, 404);

  const publishDraftWebinar = await fetch(`${baseUrl}/api/webinars/${webinarId}/sales-pages/${pageId}/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-test-user-id": ownerId },
    body: JSON.stringify({ version: 1 }),
  });
  assert.equal(publishDraftWebinar.status, 409);
  assert.equal(statusMutationCalled, false);
});

test("checkout distinguishes direct published sales pages from trusted CTA attribution", async (t) => {
  const webinarId = "checkout-webinar";
  const ownerId = "checkout-owner";
  const offerId = "7780bedb-f243-4f24-98ef-d97d0107ca42";
  const salesPageId = "6680bedb-f243-4f24-98ef-d97d0107ca42";
  const ctaId = "5580bedb-f243-4f24-98ef-d97d0107ca42";
  const webinar = { id: webinarId, userId: ownerId, publishStatus: "published" } as Webinar;
  const offer = {
    id: offerId, webinarId, active: true, paymentProvider: "ecpay",
    ecpayItemName: "Published offer", ecpayAmountTwd: 100, checkoutMode: "payment",
  } as WebinarOffer;
  const page = {
    id: salesPageId, webinarId, offerId, slug: "published-offer", status: "published",
  } as OfferSalesPage;
  let directContext: { webinarId: string; offerId: string; salesPageId: string } | undefined;
  let directAvailable = false;
  let ctaLookupCalled = false;
  const originals = {
    getWebinar: storage.getWebinar,
    getUser: storage.getUser,
    getWebinarOffer: storage.getWebinarOffer,
    getCtaButtonsByWebinar: storage.getCtaButtonsByWebinar,
    getPublishedSalesPageCheckoutContext: storage.getPublishedSalesPageCheckoutContext,
  };
  storage.getWebinar = async id => id === webinarId ? webinar : undefined;
  storage.getUser = async id => id === ownerId ? ({
    id: ownerId,
    isActive: true,
    isSuperAdmin: false,
    subscriptionPlan: "starter",
    subscriptionStatus: "active",
    planExpiresAt: new Date(Date.now() + 86_400_000),
  } as any) : undefined;
  storage.getWebinarOffer = async id => id === offerId ? offer : undefined;
  storage.getCtaButtonsByWebinar = async () => {
    ctaLookupCalled = true;
    return [{ id: ctaId, webinarId, offerId, ctaKey: "trusted-cta-key" }] as any;
  };
  storage.getPublishedSalesPageCheckoutContext = async (requestedWebinar, requestedOffer, requestedPage) => {
    directContext = { webinarId: requestedWebinar, offerId: requestedOffer, salesPageId: requestedPage };
    return directAvailable && requestedWebinar === webinarId && requestedOffer === offerId && requestedPage === salesPageId
      ? { page, offer }
      : undefined;
  };

  const app = express();
  app.use(express.json());
  // The production limiter keys authenticated visitors by session user ID.
  // Give this integration server a unique buyer identity so database-backed
  // buckets cannot leak into another concurrently-run integration test.
  const buyerId = `sales-page-checkout-${crypto.randomUUID()}`;
  app.use((_req, _res, next) => {
    (_req as any).session = { userId: buyerId };
    next();
  });
  const server = createServer(app);
  await registerRoutes(server, app, undefined, { startScheduler: () => {} });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}/api/webinars/${webinarId}/offer-checkout`;
  t.after(async () => {
    Object.assign(storage, originals);
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });

  const body = { offerId, salesPageId, sessionId: "buyer-session-identity" };
  const draftOrUnpublished = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  assert.equal(draftOrUnpublished.status, 404);
  assert.deepEqual(directContext, { webinarId, offerId, salesPageId });

  const wrongSalesPage = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, salesPageId: "4480bedb-f243-4f24-98ef-d97d0107ca42" }),
  });
  assert.equal(wrongSalesPage.status, 404);
  const wrongPageOffer = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, offerId: "3380bedb-f243-4f24-98ef-d97d0107ca42" }),
  });
  assert.equal(wrongPageOffer.status, 404);

  const missingPageBinding = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ offerId, sessionId: "buyer-session-identity" }),
  });
  assert.equal(missingPageBinding.status, 400);

  directAvailable = true;
  const published = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  // It passes sales-page authorization and only stops at the intentionally
  // unconfigured ECPay connection, rather than exposing checkout as a 404.
  assert.equal(published.status, 409);

  ctaLookupCalled = false;
  const trustedCta = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ctaId, sessionId: "buyer-session-identity" }),
  });
  assert.equal(trustedCta.status, 409);
  assert.equal(ctaLookupCalled, true);
  assert.deepEqual(OFFER_CHECKOUT_RATE_LIMIT, { namespace: "offer-checkout", limit: 20, windowSeconds: 60 });

  // The route-level middleware runs before parsing/provider work. The first
  // six checkout requests above plus fourteen malformed requests exhaust the
  // configured allowance; request 21 is rejected by the real limiter.
  for (let index = 0; index < 14; index += 1) {
    const response = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 400);
  }
  const limited = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(limited.status, 429);
  assert.ok(limited.headers.get("retry-after"));
});

test("public sales-page identity is returned and authorizes its bound direct checkout", async (t) => {
  const webinarId = "public-sales-webinar";
  const ownerId = "public-sales-owner";
  const offerId = "7780bedb-f243-4f24-98ef-d97d0107ca42";
  const salesPageId = "6680bedb-f243-4f24-98ef-d97d0107ca42";
  const webinar = { id: webinarId, userId: ownerId, publishStatus: "published" } as Webinar;
  const offer = {
    id: offerId, webinarId, active: true, paymentProvider: "ecpay",
    ecpayItemName: "Public offer", ecpayAmountTwd: 100, checkoutMode: "payment",
  } as WebinarOffer;
  const page = {
    id: salesPageId, webinarId, offerId, slug: "public-bound-offer", title: "Public offer",
    status: "published", orderedBlocks: [], publishedAt: new Date(),
  } as OfferSalesPage;
  let directContextCalled = false;
  const originals = {
    getWebinar: storage.getWebinar,
    getUser: storage.getUser,
    getPublicOfferSalesPage: storage.getPublicOfferSalesPage,
    getPublishedSalesPageCheckoutContext: storage.getPublishedSalesPageCheckoutContext,
  };
  storage.getWebinar = async id => id === webinarId ? webinar : undefined;
  storage.getUser = async id => id === ownerId ? ({
    id: ownerId,
    isActive: true,
    isSuperAdmin: false,
    subscriptionPlan: "starter",
    subscriptionStatus: "active",
    planExpiresAt: new Date(Date.now() + 86_400_000),
  } as any) : undefined;
  storage.getPublicOfferSalesPage = async slug => slug === page.slug ? { page, offer } : undefined;
  storage.getPublishedSalesPageCheckoutContext = async (requestedWebinar, requestedOffer, requestedPage) => {
    directContextCalled = true;
    return requestedWebinar === webinarId && requestedOffer === offerId && requestedPage === salesPageId
      ? { page, offer }
      : undefined;
  };

  const app = express();
  app.use(express.json());
  const buyerId = `public-sales-page-checkout-${crypto.randomUUID()}`;
  app.use((_req, _res, next) => {
    (_req as any).session = { userId: buyerId };
    next();
  });
  const server = createServer(app);
  await registerRoutes(server, app, undefined, { startScheduler: () => {} });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    Object.assign(storage, originals);
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });

  const publicResponse = await fetch(`${baseUrl}/api/sales-pages/${page.slug}`);
  assert.equal(publicResponse.status, 200);
  const publicPage = await publicResponse.json() as { id?: string; webinarId: string; offerId: string };
  assert.equal(publicPage.id, salesPageId);

  const checkoutUrl = `${baseUrl}/api/webinars/${publicPage.webinarId}/offer-checkout`;
  const missingId = await fetch(checkoutUrl, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ offerId: publicPage.offerId, sessionId: "buyer-session-identity" }),
  });
  assert.equal(missingId.status, 400);

  const boundCheckout = await fetch(checkoutUrl, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      offerId: publicPage.offerId,
      salesPageId: publicPage.id,
      sessionId: "buyer-session-identity",
    }),
  });
  // Page authorization succeeds; no ECPay merchant is configured in the test.
  assert.equal(boundCheckout.status, 409);
  assert.equal(directContextCalled, true);
});