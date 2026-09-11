import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createServer } from "node:http";
import { registerRoutes } from "./routes";
import { storage } from "./storage";
import type { Webinar } from "@shared/schema";

test("child deletion always passes the URL webinar scope to storage", async (t) => {
  const webinarId = "tenant-a-webinar";
  const ownerId = "tenant-a";
  const calls: Array<[string, string]> = [];
  const originals = {
    getWebinar: storage.getWebinar,
    getUser: storage.getUser,
    deleteScheduledMessage: storage.deleteScheduledMessage,
    deleteTip: storage.deleteTip,
    deletePoll: storage.deletePoll,
    deleteWebinarSession: storage.deleteWebinarSession,
  };
  storage.getWebinar = async (id) => id === webinarId
    ? { id, userId: ownerId, publishStatus: "draft" } as Webinar
    : undefined;
  storage.getUser = async id => id === ownerId ? { id, isActive: true, isSuperAdmin: false } as any : undefined;
  storage.deleteScheduledMessage = async (scope, id) => { calls.push([scope, id]); return false; };
  storage.deleteTip = async (scope, id) => { calls.push([scope, id]); return false; };
  storage.deletePoll = async (scope, id) => { calls.push([scope, id]); return false; };
  storage.deleteWebinarSession = async (scope, id) => { calls.push([scope, id]); return false; };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = { userId: ownerId };
    next();
  });
  const server = createServer(app);
  await registerRoutes(server, app, undefined, { startScheduler: () => {} });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}/api/webinars/${webinarId}`;

  t.after(async () => {
    Object.assign(storage, originals);
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  for (const path of [
    "/scheduled-messages/public-child-from-tenant-b",
    "/tips/public-child-from-tenant-b",
    "/polls/public-child-from-tenant-b",
    "/sessions/public-child-from-tenant-b",
  ]) {
    const response = await fetch(base + path, { method: "DELETE" });
    assert.equal(response.status, 404);
  }
  assert.deepEqual(calls, [
    [webinarId, "public-child-from-tenant-b"],
    [webinarId, "public-child-from-tenant-b"],
    [webinarId, "public-child-from-tenant-b"],
    [webinarId, "public-child-from-tenant-b"],
  ]);
});

test("super admin receives owner detail projection and administrator Q&A on a tenant draft", async (t) => {
  const webinarId = "managed-tenant-draft";
  const webinar = {
    id: webinarId, userId: "tenant-owner", publishStatus: "draft",
    title: "Managed draft", vimeoUrl: "https://vimeo.com/123456",
  } as Webinar;
  const originals = {
    getWebinar: storage.getWebinar,
    getUser: storage.getUser,
    getQuestionsByWebinar: storage.getQuestionsByWebinar,
    publishWebinarWithinLimit: storage.publishWebinarWithinLimit,
  };
  let admissionOwnerId: string | undefined;
  storage.getWebinar = async (id) => id === webinarId ? webinar : undefined;
  storage.getUser = async (id) => id === "super-admin"
    ? { id, isSuperAdmin: true, isActive: true } as any
    : { id, isSuperAdmin: false, isActive: true, subscriptionPlan: "enterprise" } as any;
  storage.getQuestionsByWebinar = async () => [{
    id: "private-question", webinarId, question: "private",
    isPublic: false, askerEmail: "private@example.test", registrationId: "registration",
  }] as any;
  storage.publishWebinarWithinLimit = async (ownerId) => {
    admissionOwnerId = ownerId;
    return { webinar: { ...webinar, publishStatus: "published" }, limitExceeded: false };
  };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = { userId: "super-admin" };
    next();
  });
  const server = createServer(app);
  await registerRoutes(server, app, undefined, {
    startScheduler: () => {},
    refreshEntitlement: async () => ({
      plan: "enterprise", status: "active", active: true, amountUsd: null,
      maxWebinars: 999, addonWebinars: 0, startedAt: null, currentPeriodEnd: null,
      cancelAtPeriodEnd: false, stripeSubscriptionId: null,
    }),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}/api/webinars/${webinarId}`;

  t.after(async () => {
    Object.assign(storage, originals);
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  const detail = await (await fetch(base)).json();
  assert.equal(detail.vimeoUrl, webinar.vimeoUrl);
  const questions = await (await fetch(`${base}/questions`)).json();
  assert.equal(questions[0].askerEmail, "private@example.test");
  const published = await fetch(`${base}/publish`, { method: "POST" });
  assert.equal(published.status, 200);
  assert.equal(admissionOwnerId, "tenant-owner");
});