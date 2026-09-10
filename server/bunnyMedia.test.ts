import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { BunnyMediaClient, MediaProviderError, bunnyVideoStatus, readBunnyMediaConfig } from "./bunnyMedia";
import { reconcileVideoReservation } from "./bunnyMediaRoutes";

const config = {
  streamApiKey: "test-api-key",
  streamLibraryId: "12345",
  streamTokenKey: "distinct-test-token-key",
  storageAccessKey: "test-storage-key",
  storageZone: "test-zone",
  storageHost: "sg.storage.bunnycdn.com",
  cdnBaseUrl: "https://cdn.example.test",
};

test("TUS renewal signature follows Bunny's documented field order and expiry", () => {
  const client = new BunnyMediaClient(config, async () => { throw new Error("network must not be called"); });
  const now = Date.UTC(2026, 0, 1);
  const upload = client.createUploadAuthorization("00000000-0000-4000-8000-000000000001", now);
  const expire = String(Math.floor((now + 15 * 60_000) / 1000));
  const expected = crypto.createHash("sha256")
    .update(`12345test-api-key${expire}00000000-0000-4000-8000-000000000001`)
    .digest("hex");
  assert.equal(upload.headers.AuthorizationSignature, expected);
  assert.equal(upload.headers.AuthorizationExpire, expire);
  assert.equal(upload.headers.LibraryId, "12345");
});

test("playback fails closed without the distinct token security key", () => {
  const client = new BunnyMediaClient({ ...config, streamTokenKey: undefined });
  assert.equal(client.streamEnabled(), true);
  assert.equal(client.playbackEnabled(), false);
  assert.throws(
    () => client.playback("00000000-0000-4000-8000-000000000001"),
    (error: unknown) => error instanceof MediaProviderError && error.code === "MEDIA_NOT_CONFIGURED",
  );
});

test("runtime playback stays disabled until provider-side embed authentication is verified", () => {
  const env = {
    BUNNY_STREAM_API_KEY: "test-api-key",
    BUNNY_STREAM_LIBRARY_ID: "12345",
    BUNNY_STREAM_TOKEN_KEY: "test-token-key",
  };
  const unverified = new BunnyMediaClient(readBunnyMediaConfig(env));
  assert.equal(unverified.streamEnabled(), true);
  assert.equal(unverified.playbackEnabled(), false);
  const verified = new BunnyMediaClient(readBunnyMediaConfig({
    ...env,
    BUNNY_STREAM_PLAYBACK_VERIFIED: "true",
  }));
  assert.equal(verified.playbackEnabled(), true);
});

test("playback token never substitutes the Stream API key", () => {
  const client = new BunnyMediaClient(config);
  const now = Date.UTC(2026, 0, 1);
  const videoId = "00000000-0000-4000-8000-000000000001";
  const playback = client.playback(videoId, now);
  const expiration = Math.floor((now + 5 * 60_000) / 1000);
  const expected = crypto.createHash("sha256")
    .update(`distinct-test-token-key${videoId}${expiration}`)
    .digest("hex");
  assert.match(playback.embedUrl, new RegExp(`token=${expected}&expires=${expiration}$`));
  assert.doesNotMatch(playback.embedUrl, /test-api-key/);
});

test("provider status mapping only treats documented Finished as ready", () => {
  assert.equal(bunnyVideoStatus(0), "uploading");
  assert.equal(bunnyVideoStatus(2), "processing");
  assert.equal(bunnyVideoStatus(4), "ready");
  assert.equal(bunnyVideoStatus(5), "failed");
  assert.equal(bunnyVideoStatus(6), "failed");
});

test("storage rejects non-Bunny API hosts before making a request", async () => {
  let called = false;
  const client = new BunnyMediaClient(
    { ...config, storageHost: "attacker.example" },
    async () => { called = true; return new Response(); },
  );
  await assert.rejects(() => client.putImage("owner/image.png", Buffer.from("x"), "image/png"), MediaProviderError);
  assert.equal(called, false);
});

test("storage reads distinguish missing objects from rejected credentials", async () => {
  const missing = new BunnyMediaClient(config, async () => new Response("", { status: 404 }));
  assert.equal(await missing.getImage("owner/image.png"), null);

  const rejected = new BunnyMediaClient(config, async () => new Response("", { status: 401 }));
  await assert.rejects(
    () => rejected.getImage("owner/image.png"),
    (error: unknown) => error instanceof MediaProviderError && error.httpStatus === 401,
  );
});

test("video status response must match the requested provider id", async () => {
  const client = new BunnyMediaClient(config, async () => new Response(JSON.stringify({
    guid: "00000000-0000-4000-8000-000000000099",
    status: 4,
    length: 10,
  }), { status: 200, headers: { "Content-Type": "application/json" } }));
  await assert.rejects(
    () => client.getVideo("00000000-0000-4000-8000-000000000001"),
    (error: unknown) => error instanceof MediaProviderError && error.code === "MEDIA_PROVIDER_UNAVAILABLE",
  );
});

test("verified provider bytes replace an under-declared quota reservation", () => {
  assert.deepEqual(reconcileVideoReservation(1, 900_000_000, 0), {
    verifiedBytes: 900_000_000,
    overLimit: false,
  });
  assert.equal(reconcileVideoReservation(1, 2 * 1024 * 1024 * 1024 + 1, 0).overLimit, true);
  assert.equal(reconcileVideoReservation(1, 900_000_000, 10 * 1024 * 1024 * 1024 - 800_000_000).overLimit, true);
});