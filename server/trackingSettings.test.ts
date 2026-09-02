import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createServer } from "node:http";
import {
  gtmContainerIdSchema,
  metaPixelIdSchema,
  safeCtaUrlSchema,
  webinarTrackingSettingsSchema,
  type Webinar,
} from "@shared/schema";
import { registerRoutes } from "./routes";
import { storage } from "./storage";
import { db } from "./db";

test("tracking identifier validators normalize blanks and reject executable input", () => {
  assert.equal(metaPixelIdSchema.parse("  123456789  "), "123456789");
  assert.equal(metaPixelIdSchema.parse("   "), null);
  assert.equal(gtmContainerIdSchema.parse(" GTM-ABC123 "), "GTM-ABC123");
  assert.equal(gtmContainerIdSchema.parse(""), null);
  for (const invalid of ["123<script>", "https://example.com/pixel", "1", "123 456"]) {
    assert.equal(metaPixelIdSchema.safeParse(invalid).success, false);
  }
  for (const invalid of ["gtm-ABC123", "GTM-abc123", "GTM-A<script>", "https://tagmanager.google.com"]) {
    assert.equal(gtmContainerIdSchema.safeParse(invalid).success, false);
  }
  assert.equal(webinarTrackingSettingsSchema.safeParse({ metaPixelId: "12345", customScript: "alert(1)" }).success, false);
});

test("CTA URLs permit only absolute HTTP(S) targets", () => {
  assert.equal(safeCtaUrlSchema.safeParse("https://example.com/buy").success, true);
  assert.equal(safeCtaUrlSchema.safeParse("http://localhost:3000/buy").success, true);
  for (const invalid of ["javascript:alert(1)", "data:text/html,test", "//evil.example/path", "/relative", "not a url"]) {
    assert.equal(safeCtaUrlSchema.safeParse(invalid).success, false);
  }
});

test("webinar PATCH validates tracking IDs and public reads suppress unsafe legacy values", async (t) => {
  const ownerId = "tracking-owner";
  const webinarId = "tracking-webinar";
  const webinar = {
    id: webinarId,
    userId: ownerId,
    publishStatus: "published",
    metaPixelId: "<script>alert(1)</script>",
    gtmContainerId: "GTM-ABC123",
  } as Webinar;
  const originals = {
    getWebinar: storage.getWebinar,
    updateWebinar: storage.updateWebinar,
  };
  let updateData: Record<string, unknown> | undefined;
  storage.getWebinar = async id => id === webinarId ? webinar : undefined;
  storage.updateWebinar = async (_id, data) => {
    updateData = data as Record<string, unknown>;
    return { ...webinar, ...data } as Webinar;
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
    storage.getWebinar = originals.getWebinar;
    storage.updateWebinar = originals.updateWebinar;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });

  const publicResponse = await fetch(`${baseUrl}/api/webinars/${webinarId}`);
  assert.equal(publicResponse.status, 200);
  const publicWebinar = await publicResponse.json() as Webinar;
  assert.equal(publicWebinar.metaPixelId, null);
  assert.equal(publicWebinar.gtmContainerId, "GTM-ABC123");

  const invalidPatch = await fetch(`${baseUrl}/api/webinars/${webinarId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-test-user-id": ownerId },
    body: JSON.stringify({ metaPixelId: "javascript:alert(1)" }),
  });
  assert.equal(invalidPatch.status, 400);
  assert.equal(updateData, undefined);

  const validPatch = await fetch(`${baseUrl}/api/webinars/${webinarId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-test-user-id": ownerId },
    body: JSON.stringify({ metaPixelId: " 123456789 ", gtmContainerId: "   " }),
  });
  assert.equal(validPatch.status, 200);
  assert.equal(updateData?.metaPixelId, "123456789");
  assert.equal(updateData?.gtmContainerId, null);
});

test("public funnel ingestion categorically rejects purchase events", async (t) => {
  const webinarId = "published-funnel";
  const originalExecute = db.execute;
  const originalWebinar = storage.getWebinar;
  const originalCreate = storage.createFunnelEvent;
  let inserted = false;
  (db as any).execute = async () => ({ rows: [{ request_count: 1, expires_at: new Date(Date.now() + 60_000) }] });
  storage.getWebinar = async id => id === webinarId
    ? ({ id, userId: "owner", publishStatus: "published" } as Webinar)
    : undefined;
  storage.createFunnelEvent = async () => {
    inserted = true;
    throw new Error("must not be called");
  };
  const app = express();
  app.use(express.json());
  const server = createServer(app);
  await registerRoutes(server, app, undefined, { startScheduler: () => {} });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  t.after(async () => {
    (db as any).execute = originalExecute;
    storage.getWebinar = originalWebinar;
    storage.createFunnelEvent = originalCreate;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  const response = await fetch(`http://127.0.0.1:${address.port}/api/webinars/${webinarId}/funnel-events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      eventType: "purchase",
      visitorToken: "visitor-token-long-enough",
      dedupeKey: "purchase-attempt-1",
      value: 99,
      currency: "USD",
    }),
  });
  assert.equal(response.status, 403);
  assert.equal(inserted, false);
});