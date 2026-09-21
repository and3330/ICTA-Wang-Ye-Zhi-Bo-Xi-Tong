import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createServer } from "node:http";
import { WebSocket } from "ws";
import { registerRoutes } from "./routes";
import { storage } from "./storage";
import { db } from "./db";
import { noCardTrials, users } from "@shared/schema";
import { eq } from "drizzle-orm";
import type { SubscriptionEntitlement } from "./subscriptionEntitlements";
import type { Registration, User, Webinar, WebinarFunnelEvent } from "@shared/schema";

function receiveMessages(socket: WebSocket, count: number): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const messages: any[] = [];
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for WebSocket messages")), 3000);
    socket.on("message", (data) => {
      messages.push(JSON.parse(data.toString()));
      if (messages.length === count) {
        clearTimeout(timeout);
        resolve(messages);
      }
    });
    socket.on("error", reject);
  });
}

test("draft access and expired publishing are enforced through real HTTP and WebSocket handlers", async (t) => {
  const ownerId = "route-test-owner";
  const webinarId = "route-test-draft";
  const draft = {
    id: webinarId,
    userId: ownerId,
    title: "Retained draft",
    description: "Content survives subscription expiry",
    publishStatus: "draft",
  } as Webinar;
  const user = { id: ownerId, isActive: true } as User;
  let publishAttempted = false;
  let entitlementRefreshCalled = false;

  const originals = {
    getWebinar: storage.getWebinar,
    getUser: storage.getUser,
    getChatMessagesBySession: storage.getChatMessagesBySession,
    getLikes: storage.getLikes,
    publishWebinarWithinLimit: storage.publishWebinarWithinLimit,
  };
  storage.getWebinar = async (id) => id === webinarId ? draft : undefined;
  storage.getUser = async (id) => id === ownerId ? user : undefined;
  storage.getChatMessagesBySession = async () => [];
  storage.getLikes = async () => undefined;
  storage.publishWebinarWithinLimit = async () => {
    publishAttempted = true;
    return { webinar: draft, limitExceeded: false };
  };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = req.header("x-test-user-id");
    (req as any).session = userId ? { userId } : {};
    next();
  });
  const server = createServer(app);
  const sessionMiddleware = (req: any, _res: any, next: () => void) => {
    const userId = req.headers["x-test-user-id"];
    req.session = userId ? { userId } : {};
    next();
  };
  const expiredEntitlement: SubscriptionEntitlement = {
    plan: "growth",
    status: "canceled",
    active: false,
    maxWebinars: 0,
    addonWebinars: 0,
    startedAt: new Date("2026-08-01T00:00:00.000Z"),
    currentPeriodEnd: new Date("2026-08-31T00:00:00.000Z"),
    cancelAtPeriodEnd: true,
    stripeSubscriptionId: "sub_expired",
  };
  await registerRoutes(server, app, sessionMiddleware, {
    refreshEntitlement: async () => {
      entitlementRefreshCalled = true;
      return expiredEntitlement;
    },
    startScheduler: () => {},
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const httpUrl = `http://127.0.0.1:${address.port}`;
  const wsUrl = `ws://127.0.0.1:${address.port}/ws`;

  t.after(async () => {
    storage.getWebinar = originals.getWebinar;
    storage.getUser = originals.getUser;
    storage.getChatMessagesBySession = originals.getChatMessagesBySession;
    storage.getLikes = originals.getLikes;
    storage.publishWebinarWithinLimit = originals.publishWebinarWithinLimit;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });

  const anonymousHttp = await fetch(`${httpUrl}/api/webinars/${webinarId}`);
  assert.equal(anonymousHttp.status, 404);

  const ownerHttp = await fetch(`${httpUrl}/api/webinars/${webinarId}`, {
    headers: { "x-test-user-id": ownerId },
  });
  assert.equal(ownerHttp.status, 200);
  assert.equal((await ownerHttp.json() as Webinar).description, draft.description);

  const anonymousSocket = new WebSocket(wsUrl);
  await new Promise<void>((resolve) => anonymousSocket.once("open", resolve));
  const anonymousReply = receiveMessages(anonymousSocket, 1);
  anonymousSocket.send(JSON.stringify({
    type: "join",
    data: { webinarId, sessionId: "anonymous-session", nickname: "anonymous" },
  }));
  assert.equal((await anonymousReply)[0].type, "error");
  anonymousSocket.close();

  const ownerSocket = new WebSocket(wsUrl, {
    headers: { "x-test-user-id": ownerId },
  });
  await new Promise<void>((resolve) => ownerSocket.once("open", resolve));
  const ownerReplies = receiveMessages(ownerSocket, 2);
  ownerSocket.send(JSON.stringify({
    type: "join",
    data: { webinarId, sessionId: "owner-session", nickname: "owner" },
  }));
  assert.deepEqual((await ownerReplies).map((message) => message.type), ["history", "sessionConfirmed"]);
  ownerSocket.close();

  const publishResponse = await fetch(`${httpUrl}/api/webinars/${webinarId}/publish`, {
    method: "POST",
    headers: { "x-test-user-id": ownerId },
  });
  assert.equal(publishResponse.status, 403);
  assert.equal((await publishResponse.json() as { code: string }).code, "SUBSCRIPTION_REQUIRED");
  assert.equal(entitlementRefreshCalled, true);
  assert.equal(publishAttempted, false);

  const retainedResponse = await fetch(`${httpUrl}/api/webinars/${webinarId}`, {
    headers: { "x-test-user-id": ownerId },
  });
  assert.equal(retainedResponse.status, 200);
  assert.equal((await retainedResponse.json() as Webinar).description, draft.description);
});

test("an active no-card trial can publish one webinar and expose it publicly", async (t) => {
  const ownerId = `route-trial-owner-${Date.now()}`;
  const webinarId = `route-trial-webinar-${Date.now()}`;
  const user = {
    id: ownerId,
    username: ownerId,
    password: "test-only",
    email: `${ownerId}@example.test`,
    isActive: true,
    isSuperAdmin: false,
    subscriptionPlan: "free",
    subscriptionStatus: "inactive",
  } as User;
  const webinar = {
    id: webinarId,
    userId: ownerId,
    title: "Trial webinar",
    description: "Trial members can start using one published room",
    publishStatus: "draft",
    vimeoUrl: "https://vimeo.com/123456789",
    videoProvider: "vimeo",
    videoAssetId: null,
    videoDuration: 60,
  } as Webinar;
  await db.insert(users).values(user as any);
  const trialStartsAt = new Date(Date.now() - 60_000);
  const trialExpiresAt = new Date(trialStartsAt.getTime() + 14 * 24 * 60 * 60 * 1000);
  await db.insert(noCardTrials).values({
    userId: ownerId,
    startsAt: trialStartsAt,
    expiresAt: trialExpiresAt,
    retentionUntil: new Date(trialExpiresAt.getTime() + 30 * 24 * 60 * 60 * 1000),
  });

  const originals = {
    getWebinar: storage.getWebinar,
    getAllWebinars: storage.getAllWebinars,
    getUser: storage.getUser,
    publishWebinarWithinLimit: storage.publishWebinarWithinLimit,
  };
  storage.getWebinar = async (id) => id === webinarId ? webinar : undefined;
  storage.getAllWebinars = async () => [webinar];
  storage.getUser = async (id) => id === ownerId ? user : undefined;
  storage.publishWebinarWithinLimit = async () => {
    webinar.publishStatus = "published";
    return { webinar, limitExceeded: false, maxPublished: 1 };
  };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = req.header("x-test-user-id");
    (req as any).session = userId ? { userId } : {};
    next();
  });
  const server = createServer(app);
  await registerRoutes(server, app, undefined, {
    refreshEntitlement: async () => ({
      plan: "free", status: "inactive", active: false, amountUsd: null,
      maxWebinars: 0, addonWebinars: 0, startedAt: null,
      currentPeriodEnd: null, cancelAtPeriodEnd: false, stripeSubscriptionId: null,
    }),
    startScheduler: () => {},
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  t.after(async () => {
    storage.getWebinar = originals.getWebinar;
    storage.getAllWebinars = originals.getAllWebinars;
    storage.getUser = originals.getUser;
    storage.publishWebinarWithinLimit = originals.publishWebinarWithinLimit;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await db.delete(noCardTrials).where(eq(noCardTrials.userId, ownerId));
    await db.delete(users).where(eq(users.id, ownerId));
  });

  const publish = await fetch(`${baseUrl}/api/webinars/${webinarId}/publish`, {
    method: "POST",
    headers: { "x-test-user-id": ownerId },
  });
  assert.equal(publish.status, 200);

  const publicView = await fetch(`${baseUrl}/api/webinars/${webinarId}`);
  assert.equal(publicView.status, 200, "the published room is public while the trial is active");

  const expiredStartsAt = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
  const expiredAt = new Date(expiredStartsAt.getTime() + 14 * 24 * 60 * 60 * 1000);
  await db.update(noCardTrials).set({
    startsAt: expiredStartsAt,
    expiresAt: expiredAt,
    retentionUntil: new Date(expiredAt.getTime() + 30 * 24 * 60 * 60 * 1000),
  }).where(eq(noCardTrials.userId, ownerId));

  const expiredPublicView = await fetch(`${baseUrl}/api/webinars/${webinarId}`);
  assert.equal(expiredPublicView.status, 404, "public access closes as soon as the trial expires");
  const expiredList = await fetch(`${baseUrl}/api/webinars`);
  assert.deepEqual(await expiredList.json(), [], "expired trial webinars are not anonymously enumerable");
});

test("public funnel endpoint rejects forged purchase and refund events", async (t) => {
  const webinarId = "9c15edb6-af0d-481e-8806-d686ad204517";
  const originalGetWebinar = storage.getWebinar;
  storage.getWebinar = async (id) => id === webinarId
    ? ({ id, publishStatus: "published", videoDuration: 100 } as Webinar)
    : undefined;
  const app = express();
  app.use(express.json());
  const server = createServer(app);
  await registerRoutes(server, app, undefined, { startScheduler: () => {} });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}/api/webinars/${webinarId}/funnel-events`;
  t.after(async () => {
    storage.getWebinar = originalGetWebinar;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  const identity = { visitorToken: "visitor-token-long-enough", dedupeKey: "forged-event-key" };
  const purchase = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...identity, eventType: "purchase", value: 1, currency: "USD" }),
  });
  assert.equal(purchase.status, 403);
  const refund = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...identity, eventType: "refund" }),
  });
  assert.equal(refund.status, 403);
});

test("lead insight HTTP routes enforce ownership and return scoped compact paginated insights", async (t) => {
  const ownerId = "lead-insights-owner";
  const otherOwnerId = "lead-insights-other-owner";
  const webinarId = "lead-insights-webinar";
  const otherWebinarId = "lead-insights-other-webinar";
  const registrationId = "lead-insights-refunded";
  const secondRegistrationId = "lead-insights-second";
  const crossWebinarRegistrationId = "lead-insights-cross-webinar";
  const webinar = {
    id: webinarId,
    userId: ownerId,
    videoDuration: 600,
  } as Webinar;
  const registrations = [
    {
      id: registrationId,
      webinarId,
      name: "Refunded lead",
      email: "refunded@example.com",
      registeredAt: new Date("2025-01-01T00:00:00Z"),
    },
    {
      id: secondRegistrationId,
      webinarId,
      name: "Second lead",
      email: "second@example.com",
      registeredAt: new Date("2025-01-02T00:00:00Z"),
    },
  ] as Registration[];
  const crossWebinarRegistration = {
    id: crossWebinarRegistrationId,
    webinarId: otherWebinarId,
    name: "Other webinar lead",
    email: "other@example.com",
    registeredAt: new Date("2025-01-03T00:00:00Z"),
  } as Registration;
  const event = (
    id: string,
    eventType: WebinarFunnelEvent["eventType"],
    registration: string,
    amountMinor: number | null = null,
  ) => ({
    id,
    webinarId,
    eventType,
    registrationId: registration,
    sessionId: null,
    ctaId: null,
    ctaKey: null,
    offerId: null,
    visitorTokenHash: null,
    positionSeconds: null,
    value: null,
    amountMinor,
    currency: amountMinor === null ? null : "TWD",
    dedupeKey: id,
    metadata: {},
    occurredAt: new Date("2025-01-04T00:00:00Z"),
  } as WebinarFunnelEvent);
  const funnelEvents = [
    event("purchase-refunded", "purchase", registrationId, 10000),
    event("refund-refunded", "refund", registrationId, 10000),
  ];
  let detailEventsCall: [string, string] | undefined;
  const originals = {
    getWebinar: storage.getWebinar,
    getUser: storage.getUser,
    getRegistration: storage.getRegistration,
    getRegistrationsByWebinar: storage.getRegistrationsByWebinar,
    getRegistrationsByWebinarPage: storage.getRegistrationsByWebinarPage,
    getFunnelEvents: storage.getFunnelEvents,
    getFunnelEventsByRegistrations: storage.getFunnelEventsByRegistrations,
    getFunnelEventsByRegistration: storage.getFunnelEventsByRegistration,
  };
  storage.getWebinar = async id => id === webinarId ? webinar : undefined;
  storage.getUser = async id => (id === ownerId || id === otherOwnerId)
    ? { id, isActive: true, isSuperAdmin: false } as any
    : undefined;
  storage.getRegistration = async id =>
    id === crossWebinarRegistrationId ? crossWebinarRegistration
      : registrations.find(registration => registration.id === id);
  storage.getRegistrationsByWebinar = async id => id === webinarId ? registrations : [];
  storage.getRegistrationsByWebinarPage = async (id, limit, offset) => ({
    registrations: id === webinarId ? registrations.slice(offset, offset + limit) : [],
    total: id === webinarId ? registrations.length : 0,
  });
  storage.getFunnelEvents = async id => id === webinarId ? funnelEvents : [];
  storage.getFunnelEventsByRegistrations = async (id, registrationIds) =>
    id === webinarId ? funnelEvents.filter(event => event.registrationId && registrationIds.includes(event.registrationId)) : [];
  storage.getFunnelEventsByRegistration = async (requestedWebinarId, requestedRegistrationId) => {
    detailEventsCall = [requestedWebinarId, requestedRegistrationId];
    return requestedRegistrationId === registrationId ? funnelEvents : [];
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
  const listUrl = `${baseUrl}/api/webinars/${webinarId}/lead-insights`;

  t.after(async () => {
    Object.assign(storage, originals);
    await new Promise<void>((resolve, reject) =>
      server.close(error => error ? reject(error) : resolve()));
  });

  const anonymous = await fetch(listUrl);
  assert.equal(anonymous.status, 401);

  const differentOwner = await fetch(listUrl, {
    headers: { "x-test-user-id": otherOwnerId },
  });
  assert.equal(differentOwner.status, 403);

  const crossWebinarDetail = await fetch(
    `${baseUrl}/api/webinars/${webinarId}/registrations/${crossWebinarRegistrationId}/insights`,
    { headers: { "x-test-user-id": ownerId } },
  );
  assert.equal(crossWebinarDetail.status, 404);
  assert.equal(detailEventsCall, undefined);

  const pageResponse = await fetch(`${listUrl}?limit=1&offset=1`, {
    headers: { "x-test-user-id": ownerId },
  });
  assert.equal(pageResponse.status, 200);
  const page = await pageResponse.json() as {
    webinarId: string;
    summary: { total: number; refunded: number };
    pagination: { total: number; limit: number; offset: number; hasMore: boolean };
    leads: Array<Record<string, unknown>>;
  };
  assert.equal(page.webinarId, webinarId);
  assert.equal(page.summary.total, 1);
  assert.equal(page.summary.refunded, 0);
  assert.deepEqual(page.pagination, { total: 2, limit: 1, offset: 1, hasMore: false });
  assert.equal(page.leads.length, 1);
  assert.deepEqual(Object.keys(page.leads[0]).sort(), [
    "evidenceCount", "lastActivityAt", "recommendation", "registrationId",
    "score", "stage", "temperature",
  ].sort());
  assert.equal(page.leads[0].registrationId, secondRegistrationId);

  const refundedDetail = await fetch(
    `${baseUrl}/api/webinars/${webinarId}/registrations/${registrationId}/insights`,
    { headers: { "x-test-user-id": ownerId } },
  );
  assert.equal(refundedDetail.status, 200);
  const refundedInsight = await refundedDetail.json() as {
    registrationId: string;
    stage: string;
    temperature: string;
    score: number;
    suppressSalesFollowUp?: boolean;
  };
  assert.equal(refundedInsight.registrationId, registrationId);
  assert.equal(refundedInsight.stage, "refunded");
  assert.equal(refundedInsight.temperature, "cold");
  assert.equal(refundedInsight.score, 0);
  assert.equal(refundedInsight.suppressSalesFollowUp, undefined);
  assert.deepEqual(detailEventsCall, [webinarId, registrationId]);
});