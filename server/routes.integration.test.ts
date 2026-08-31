import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createServer } from "node:http";
import { WebSocket } from "ws";
import { registerRoutes } from "./routes";
import { storage } from "./storage";
import type { SubscriptionEntitlement } from "./subscriptionEntitlements";
import type { User, Webinar } from "@shared/schema";

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