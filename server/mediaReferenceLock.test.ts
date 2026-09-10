import assert from "node:assert/strict";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { deletedMediaUrls, offerSalesPages, users, webinarOffers } from "@shared/schema";
import { db, pool } from "./db";
import { registerRoutes } from "./routes";
import { createMediaReferenceLock, type MediaLockConnector } from "./mediaReferenceLock";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

function responseDouble() {
  const response = new EventEmitter() as EventEmitter & Partial<Response>;
  response.headersSent = false;
  response.status = function status() { return response as Response; };
  response.json = function json() { return response as Response; };
  return response as Response;
}

function coordinationDouble() {
  const queries: string[] = [];
  let connects = 0;
  let releases = 0;
  const connector: MediaLockConnector = {
    async connect() {
      connects += 1;
      return {
        async query(query: string) {
          queries.push(query);
        },
        release() {
          releases += 1;
        },
      };
    },
  };
  return {
    connector,
    queries,
    get connects() { return connects; },
    get releases() { return releases; },
  };
}

const request = {} as Request;
const next = (() => undefined) as NextFunction;

test("response close does not release a lock before the handler Promise settles", async () => {
  const coordination = coordinationDouble();
  const withLock = createMediaReferenceLock(coordination.connector);
  const finishFirst = deferred();
  const firstStarted = deferred();
  let secondEntered = false;

  const first = withLock(async (_req, _res) => {
    firstStarted.resolve();
    await finishFirst.promise;
  });
  const second = withLock(async () => {
    secondEntered = true;
  });

  const firstResponse = responseDouble();
  const firstPromise = first(request, firstResponse, next);
  await firstStarted.promise;
  firstResponse.emit("close");
  const secondPromise = second(request, responseDouble(), next);
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(secondEntered, false);
  assert.equal(coordination.connects, 1, "a queued request must not consume a coordination client");
  finishFirst.resolve();
  await Promise.all([firstPromise, secondPromise]);
  assert.equal(secondEntered, true);
  assert.equal(coordination.releases, 2);
});

test("dedicated coordination connector does not starve a max-one application pool", async () => {
  const coordination = coordinationDouble();
  const withLock = createMediaReferenceLock(coordination.connector);
  let mainInUse = false;
  let mainQueries = 0;
  const acquireMain = async () => {
    assert.equal(mainInUse, false, "the handler must still be able to acquire the application client");
    mainInUse = true;
    return {
      async query() {
        mainQueries += 1;
      },
      release() {
        mainInUse = false;
      },
    };
  };

  const handler = withLock(async () => {
    const client = await acquireMain();
    try {
      await client.query();
    } finally {
      client.release();
    }
  });
  await Promise.all([
    handler(request, responseDouble(), next),
    handler(request, responseDouble(), next),
  ]);

  assert.equal(mainQueries, 2);
  assert.equal(coordination.connects, 2);
  assert.equal(coordination.releases, 2);
});

test("handler exceptions release the advisory lock and FIFO contender", async () => {
  const coordination = coordinationDouble();
  const withLock = createMediaReferenceLock(coordination.connector);
  let contenderRan = false;
  const failing = withLock(async () => {
    throw new Error("route failed");
  });
  const contender = withLock(async () => {
    contenderRan = true;
  });

  await assert.rejects(failing(request, responseDouble(), next), /route failed/);
  await contender(request, responseDouble(), next);

  assert.equal(contenderRan, true);
  assert.equal(
    coordination.queries.filter(query => query.includes("pg_advisory_unlock")).length,
    2,
  );
  assert.equal(coordination.releases, 2);
});

test("standalone sales-page HTTP writer rejects a tombstoned media URL", async (t) => {
  assert.notEqual(process.env.NODE_ENV, "production");
  const userId = crypto.randomUUID();
  const offerId = crypto.randomUUID();
  const deletedUrl = `https://media.example.test/${crypto.randomUUID()}.png`;
  const app = express();
  app.use(express.json());
  app.use((req, _res, nextHandler) => {
    const actor = req.header("x-test-user");
    (req as any).session = actor ? { userId: actor } : {};
    nextHandler();
  });
  const server = createServer(app);
  await registerRoutes(server, app, ((req: any, _res: any, next: () => void) => {
    req.session = { userId: req.headers["x-test-user"] };
    next();
  }) as any, {
    startScheduler: () => {},
    refreshEntitlement: async () => {
      throw new Error("media reference integration must not contact Stripe");
    },
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  t.after(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await db.delete(offerSalesPages).where(eq(offerSalesPages.offerId, offerId));
    await db.delete(deletedMediaUrls).where(eq(deletedMediaUrls.url, deletedUrl));
    await db.delete(webinarOffers).where(eq(webinarOffers.id, offerId));
    await db.delete(users).where(eq(users.id, userId));
    await pool.end();
  });

  await db.insert(users).values({
    id: userId,
    username: `reference-lock-${userId}`,
    password: "not-a-login-hash",
  });
  await db.insert(webinarOffers).values({
    id: offerId,
    userId,
    webinarId: null,
    paymentProvider: "ecpay",
    ecpayItemName: "Reference lock test",
    ecpayAmountTwd: 100,
    checkoutMode: "payment",
  });
  await db.insert(deletedMediaUrls).values({ url: deletedUrl, userId });

  const response = await fetch(`http://127.0.0.1:${address.port}/api/product-sales-pages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-test-user": userId },
    body: JSON.stringify({
      offerId,
      slug: `deleted-media-${crypto.randomUUID()}`,
      title: "Must reject deleted media",
      blocks: [{
        id: "deleted-image",
        type: "image",
        enabled: true,
        url: deletedUrl,
        alt: "Deleted image",
      }],
    }),
  });
  const body = await response.json() as { message?: string };
  assert.equal(response.status, 400, JSON.stringify(body));
  assert.match(body.message || "", /unavailable|deleted/i);
  assert.equal(
    (await db.select().from(offerSalesPages).where(eq(offerSalesPages.offerId, offerId))).length,
    0,
  );
});