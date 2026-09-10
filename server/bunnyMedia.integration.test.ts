import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import express from "express";
import { createServer } from "node:http";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "./db";
import { registerRoutes } from "./routes";
import {
  BunnyMediaClient,
  MAX_TOTAL_VIDEO_BYTES,
  setBunnyMediaClientForTests,
} from "./bunnyMedia";
import { createWatchToken } from "./watchTokens";
import {
  mediaAssets, registrationIdentityKeys, registrations, uploadedAssets, users, webinarLandingPages, webinars,
} from "@shared/schema";

// This is an application/DB integration test with a deterministic provider
// double. It must never create, upload, or delete anything in a Bunny account.
test("owned Bunny media: auth, isolation, upload signing, playback, references, and quota", async (t) => {
  assert.notEqual(process.env.NODE_ENV, "production");
  const ownerId = crypto.randomUUID();
  const otherId = crypto.randomUUID();
  const webinarId = crypto.randomUUID();
  const registrationId = crypto.randomUUID();
  const createdAssetIds: string[] = [];
  const providerVideoId = crypto.randomUUID();
  const providerCalls: Array<{ url: string; method: string; headers: Headers; body?: string }> = [];
  let remoteStatus = 1;

  const providerFetch: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    assert.match(url, /^https:\/\/(?:video|storage)\.bunnycdn\.com\//, "the provider double must only receive Bunny requests");
    const method = init?.method || "GET";
    providerCalls.push({
      url,
      method,
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    if (method === "POST" && url.endsWith("/videos")) {
      return Response.json({ guid: providerVideoId, status: remoteStatus }, { status: 201 });
    }
    if (method === "GET" && url.endsWith(`/videos/${providerVideoId}`)) {
      return Response.json({ guid: providerVideoId, status: remoteStatus, length: 91.6 });
    }
    if (method === "DELETE" && url.endsWith(`/videos/${providerVideoId}`)) {
      return new Response(null, { status: 204 });
    }
    if (method === "DELETE" && url.startsWith("https://storage.bunnycdn.com/")) {
      return new Response(null, { status: 204 });
    }
    return Response.json({ message: "unexpected fake-provider request" }, { status: 418 });
  };
  const configuredClient = () => new BunnyMediaClient({
    streamApiKey: "integration-stream-key",
    streamLibraryId: "12345",
    streamTokenKey: "integration-playback-token",
    storageAccessKey: "integration-storage-key",
    storageZone: "integration-zone",
    storageHost: "storage.bunnycdn.com",
    cdnBaseUrl: "https://media.example.test",
  }, providerFetch);
  setBunnyMediaClientForTests(configuredClient());

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const id = req.header("x-test-user");
    (req as any).session = id ? { userId: id } : {};
    next();
  });
  const server = createServer(app);
  await registerRoutes(server, app, ((req: any, _res: any, next: () => void) => {
    req.session = { userId: req.headers["x-test-user"] };
    next();
  }) as any, {
    startScheduler: () => {},
    refreshEntitlement: async () => { throw new Error("Media integration must not contact Stripe"); },
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  const originalFetch = globalThis.fetch;
  async function request(path: string, method = "GET", body?: unknown, actor?: string) {
    return originalFetch(`${base}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(actor ? { "x-test-user": actor } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  async function json(response: Response, status = 200) {
    const value = await response.json();
    assert.equal(response.status, status, JSON.stringify(value));
    return value as any;
  }

  t.after(async () => {
    setBunnyMediaClientForTests(undefined);
    await new Promise<void>(resolve => server.close(() => resolve()));
    await db.delete(registrationIdentityKeys).where(eq(registrationIdentityKeys.registrationId, registrationId));
    await db.delete(registrations).where(eq(registrations.id, registrationId));
    await db.delete(webinarLandingPages).where(eq(webinarLandingPages.webinarId, webinarId));
    await db.delete(webinars).where(eq(webinars.id, webinarId));
    await db.delete(uploadedAssets).where(inArray(uploadedAssets.userId, [ownerId, otherId]));
    if (createdAssetIds.length) await db.delete(mediaAssets).where(inArray(mediaAssets.id, createdAssetIds));
    await db.delete(users).where(inArray(users.id, [ownerId, otherId]));
    await pool.end();
  });
  await db.insert(users).values([
    {
      id: ownerId,
      username: `media-test-${ownerId}`,
      password: "not-a-login-hash",
      subscriptionPlan: "starter",
      subscriptionStatus: "active",
      planExpiresAt: new Date(Date.now() + 86_400_000),
    },
    { id: otherId, username: `media-test-${otherId}`, password: "not-a-login-hash" },
  ]);

  assert.equal((await request("/api/media/config")).status, 401);
  assert.equal((await request("/api/media")).status, 401);
  const config = await json(await request("/api/media/config", "GET", undefined, ownerId));
  assert.deepEqual(
    { videoEnabled: config.videoEnabled, imageEnabled: config.imageEnabled, playbackEnabled: config.playbackEnabled },
    { videoEnabled: true, imageEnabled: true, playbackEnabled: true },
  );

  const created = await json(await request("/api/media/videos", "POST", {
    name: "integration-video.mp4",
    sizeBytes: 8 * 1024 * 1024,
    contentType: "video/mp4",
  }, ownerId), 201);
  createdAssetIds.push(created.asset.id);
  assert.equal(created.asset.provider, "bunny_stream");
  assert.equal(created.asset.providerId, undefined, "provider identifiers must stay server-only");
  assert.equal(created.upload.endpoint, "https://video.bunnycdn.com/tusupload");
  assert.equal(created.upload.headers.VideoId, providerVideoId);
  assert.equal(created.upload.headers.LibraryId, "12345");
  const uploadExpire = created.upload.headers.AuthorizationExpire;
  assert.equal(
    created.upload.headers.AuthorizationSignature,
    crypto.createHash("sha256").update(`12345integration-stream-key${uploadExpire}${providerVideoId}`).digest("hex"),
  );
  assert.ok(Date.parse(created.upload.expiresAt) > Date.now());
  assert.deepEqual(JSON.parse(providerCalls[0].body!), { title: "integration-video.mp4" });
  assert.equal(providerCalls[0].headers.get("AccessKey"), "integration-stream-key");

  assert.equal((await request(`/api/media/${created.asset.id}`, "GET", undefined, otherId)).status, 404);
  assert.equal((await request(`/api/media/${created.asset.id}/refresh`, "POST", {}, otherId)).status, 404);
  assert.equal((await request(`/api/media/${created.asset.id}`, "DELETE", undefined, otherId)).status, 404);
  assert.equal(providerCalls.length, 1, "cross-tenant requests must not reach the provider");

  const foreignAssetId = crypto.randomUUID();
  createdAssetIds.push(foreignAssetId);
  await db.insert(mediaAssets).values({
    id: foreignAssetId,
    userId: otherId,
    kind: "video",
    provider: "bunny_stream",
    providerId: crypto.randomUUID(),
    name: "other tenant ready video",
    status: "ready",
    sizeBytes: 1024,
  });
  const crossTenantReference = await json(await request("/api/webinars", "POST", {
    title: "Must not reference another tenant",
    description: "",
    vimeoUrl: "",
    videoProvider: "bunny",
    videoAssetId: foreignAssetId,
    startTime: new Date(Date.now() + 86_400_000).toISOString(),
  }, ownerId), 400);
  assert.match(crossTenantReference.message, /owned by this member/i);

  const renewed = await json(await request(
    `/api/media/${created.asset.id}/upload-authorization`, "POST", {}, ownerId,
  ));
  assert.equal(renewed.upload.headers.VideoId, providerVideoId);
  assert.match(renewed.upload.headers.AuthorizationSignature, /^[0-9a-f]{64}$/);
  assert.equal(providerCalls.at(-1)?.method, "GET");

  remoteStatus = 4;
  const refreshed = await json(await request(`/api/media/${created.asset.id}/refresh`, "POST", {}, ownerId));
  assert.equal(refreshed.status, "ready");
  assert.equal(refreshed.durationSeconds, 92);
  const listing = await json(await request("/api/media", "GET", undefined, ownerId));
  assert.deepEqual(listing.assets.map((asset: any) => asset.id), [created.asset.id]);
  assert.equal(listing.usage.videoBytes, 8 * 1024 * 1024);
  assert.equal(listing.assets[0].providerId, undefined);

  const playback = await json(await request(`/api/media/${created.asset.id}/playback`, "GET", undefined, ownerId));
  const playbackUrl = new URL(playback.embedUrl);
  const expires = playbackUrl.searchParams.get("expires")!;
  assert.equal(
    playbackUrl.searchParams.get("token"),
    crypto.createHash("sha256").update(`integration-playback-token${providerVideoId}${expires}`).digest("hex"),
  );
  assert.equal(playback.videoId, providerVideoId);

  setBunnyMediaClientForTests(new BunnyMediaClient({
    streamApiKey: "integration-stream-key",
    streamLibraryId: "12345",
    storageAccessKey: "integration-storage-key",
    storageZone: "integration-zone",
    storageHost: "storage.bunnycdn.com",
    cdnBaseUrl: "https://media.example.test",
  }, providerFetch));
  const missingToken = await json(
    await request(`/api/media/${created.asset.id}/playback`, "GET", undefined, ownerId),
    503,
  );
  assert.equal(missingToken.code, "MEDIA_NOT_CONFIGURED");
  setBunnyMediaClientForTests(configuredClient());

  await db.insert(webinars).values({
    id: webinarId,
    userId: ownerId,
    title: "Referenced media integration webinar",
    vimeoUrl: "",
    videoProvider: "bunny",
    videoAssetId: created.asset.id,
    startTime: new Date(Date.now() + 86_400_000),
  });
  const callsBeforeReferencedDelete = providerCalls.length;
  assert.equal((await request(`/api/media/${created.asset.id}`, "DELETE", undefined, ownerId)).status, 409);
  assert.equal(providerCalls.length, callsBeforeReferencedDelete, "reference rejection must precede provider deletion");
  await db.update(webinars).set({ videoProvider: "vimeo", videoAssetId: null }).where(eq(webinars.id, webinarId));

  await db.insert(webinarLandingPages).values({
    webinarId,
    title: "Referenced landing media",
    blocks: [{ id: "draft-video", type: "video", enabled: true, provider: "bunny", videoId: created.asset.id }],
  });
  assert.equal((await request(`/api/media/${created.asset.id}`, "DELETE", undefined, ownerId)).status, 409);
  await db.update(webinarLandingPages).set({
    blocks: [],
    publishedBlocks: [{ id: "published-video", type: "video", enabled: true, provider: "bunny", videoId: created.asset.id }],
  }).where(eq(webinarLandingPages.webinarId, webinarId));
  assert.equal((await request(`/api/media/${created.asset.id}`, "DELETE", undefined, ownerId)).status, 409);
  await db.update(webinarLandingPages).set({ publishedBlocks: [] }).where(eq(webinarLandingPages.webinarId, webinarId));

  const imageId = crypto.randomUUID();
  const uploadId = crypto.randomUUID();
  createdAssetIds.push(imageId);
  const imageUrl = "https://media.example.test/owned-image.png";
  const imageKey = `${ownerId}/images/owned-image.png`;
  await db.insert(mediaAssets).values({
    id: imageId, userId: ownerId, kind: "image", provider: "bunny_storage",
    storageKey: imageKey, name: "owned-image.png", status: "ready", sizeBytes: 68, url: imageUrl,
  });
  await db.insert(uploadedAssets).values({
    id: uploadId, userId: ownerId, url: imageUrl, filename: `${ownerId}-owned-image.png`,
    storageBackend: "bunny_storage", storageKey: imageKey, contentType: "image/png", sizeBytes: 68,
  });
  const callsBeforeForeignImageDelete = providerCalls.length;
  assert.equal((await request("/api/upload", "DELETE", { url: imageUrl }, otherId)).status, 404);
  assert.equal(providerCalls.length, callsBeforeForeignImageDelete, "cross-tenant image deletion must not reach storage");
  await json(await request("/api/upload", "DELETE", { url: imageUrl }, ownerId));
  assert.equal(providerCalls.at(-1)?.method, "DELETE");
  assert.ok(providerCalls.at(-1)?.url.includes(encodeURIComponent("integration-zone")));

  const quotaId = crypto.randomUUID();
  createdAssetIds.push(quotaId);
  await db.insert(mediaAssets).values({
    id: quotaId,
    userId: ownerId,
    kind: "video",
    provider: "legacy",
    name: "quota reservation",
    status: "ready",
    sizeBytes: MAX_TOTAL_VIDEO_BYTES - 8 * 1024 * 1024,
  });
  const callsBeforeQuota = providerCalls.length;
  const overQuota = await json(await request("/api/media/videos", "POST", {
    name: "over-quota.mp4",
    sizeBytes: 1,
    contentType: "video/mp4",
  }, ownerId), 409);
  assert.equal(overQuota.code, "MEDIA_QUOTA_EXCEEDED");
  assert.equal(providerCalls.length, callsBeforeQuota, "quota rejection must not create a provider video");
  await db.delete(mediaAssets).where(eq(mediaAssets.id, quotaId));

  await json(await request(`/api/media/${created.asset.id}`, "DELETE", undefined, ownerId));
  assert.equal(providerCalls.at(-1)?.method, "DELETE");
  assert.equal((await request(`/api/media/${created.asset.id}`, "GET", undefined, ownerId)).status, 404);

  // A legacy Vimeo webinar still returns its original playback contract, and
  // deleting the registration immediately revokes an otherwise-valid token.
  await db.update(webinars).set({
    vimeoUrl: "https://vimeo.com/987654321",
    videoProvider: "vimeo",
    videoAssetId: null,
    publishStatus: "published",
    status: "live",
    startTime: new Date(Date.now() - 60_000),
    scheduleMode: { recurring: false, onDemand: true, justInTime: false, justInTimeMinutes: 15 },
  }).where(eq(webinars.id, webinarId));
  await db.insert(registrations).values({
    id: registrationId,
    webinarId,
    name: "Media watcher",
    email: `media-watcher-${registrationId}@example.test`,
  });
  const previousSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "media-integration-watch-secret";
  const watchToken = createWatchToken(registrationId, webinarId);
  const legacyWatch = await json(await request(
    `/api/webinars/${webinarId}/watch-state?watchToken=${encodeURIComponent(watchToken)}`,
  ));
  assert.equal(legacyWatch.playback.provider, "vimeo");
  assert.equal(legacyWatch.playback.url, "https://vimeo.com/987654321");
  assert.equal(legacyWatch.vimeoUrl, "https://vimeo.com/987654321");
  await db.delete(registrationIdentityKeys).where(eq(registrationIdentityKeys.registrationId, registrationId));
  await db.delete(registrations).where(eq(registrations.id, registrationId));
  assert.equal((await request(
    `/api/webinars/${webinarId}/watch-state?watchToken=${encodeURIComponent(watchToken)}`,
  )).status, 401);
  if (previousSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = previousSecret;
});