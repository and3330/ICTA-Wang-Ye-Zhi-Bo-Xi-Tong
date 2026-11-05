import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createServer } from "node:http";
import type { User, Webinar, WebinarLandingPage } from "@shared/schema";
import { registerRoutes } from "./routes";
import { storage } from "./storage";

test("public webinar endpoints allowlist viewer fields and keep host settings private", async (t) => {
  const webinar = {
    id: "privacy-webinar",
    userId: "privacy-owner",
    title: "Public webinar",
    description: "Public description",
    vimeoUrl: "https://vimeo.com/private-source",
    videoProvider: "vimeo",
    videoAssetId: "private-asset",
    coverImage: "https://example.com/cover.jpg",
    startTime: new Date("2026-01-01T12:00:00Z"),
    status: "scheduled",
    publishStatus: "published",
    videoDuration: 120,
    scheduleMode: { recurring: true, onDemand: true, justInTime: false, justInTimeMinutes: 15 },
    recurringSchedule: { enabled: true, days: [1], times: ["12:00"], excludeDates: [] },
    timezone: "Asia/Taipei",
    brandSettings: { logo: "", watermark: "", primaryColor: "#123456", secondaryColor: "#ffffff", backgroundColor: "#ffffff" },
    aiSettings: { enabled: true, teacherName: "Private assistant", instructions: "Private instructions" },
    customFields: [{ id: "company", label: "Company", type: "text", required: false }],
    scarcitySettings: { countdownEnabled: true, seatsEnabled: true, totalSeats: 100, urgencyText: "Join now" },
    thankYouSettings: { enabled: true, headline: "Thank you", message: "See you soon", ctaText: "", ctaUrl: "" },
    replaySettings: { headline: "Replay", message: "Watch again", ctaText: "", ctaUrl: "" },
    notifySettings: { questionEmailEnabled: true, notifyEmail: "private-host@example.com" },
    emailSettings: {
      confirmationEnabled: true, reminder24hEnabled: true, reminder1hEnabled: true,
      followUpEnabled: true, customSubject: "Private campaign", customTemplate: "Private template",
    },
    replayEnabled: true,
    replayAvailableHours: 48,
    metaPixelId: "123456789",
    gtmContainerId: "GTM-ABC123",
    createdAt: new Date(),
    deletedAt: null,
    // Simulate a future internal column: a denylist would accidentally expose it.
    futurePrivateSetting: "private-future-value",
  } as Webinar & { futurePrivateSetting: string };
  const page = { id: "privacy-landing", webinarId: webinar.id, blocks: [] } as unknown as WebinarLandingPage;
  const originals = {
    getWebinar: storage.getWebinar,
    getAllWebinars: storage.getAllWebinars,
    getWebinarsByUser: storage.getWebinarsByUser,
    getUser: storage.getUser,
    getPublicWebinarLandingPage: storage.getPublicWebinarLandingPage,
    getWebinarLandingPage: storage.getWebinarLandingPage,
  };
  t.after(() => Object.assign(storage, originals));
  storage.getWebinar = async id => id === webinar.id ? webinar : undefined;
  storage.getAllWebinars = async () => [webinar];
  storage.getWebinarsByUser = async id => id === webinar.userId ? [webinar] : [];
  storage.getUser = async id => ({
    id, isActive: true, isSuperAdmin: id === "privacy-superadmin",
    subscriptionPlan: "starter", subscriptionStatus: "active",
    planExpiresAt: new Date(Date.now() + 86_400_000),
  } as User);
  storage.getPublicWebinarLandingPage = async () => page;
  storage.getWebinarLandingPage = async () => page;

  const app = express();
  app.use((req, _res, next) => {
    // Test-only session injection; no auth bypass is added to the application.
    (req as any).session = { userId: req.header("x-test-user-id") };
    next();
  });
  const server = createServer(app);
  await registerRoutes(server, app, undefined, { startScheduler: () => {} });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  async function read(path: string, userId?: string) {
    const response = await fetch(base + path, { headers: userId ? { "x-test-user-id": userId } : {} });
    assert.equal(response.status, 200, path);
    return response.json();
  }
  function assertPublic(value: Record<string, unknown>) {
    for (const key of [
      "notifySettings", "emailSettings", "vimeoUrl", "videoAssetId", "aiSettings",
      "userId", "createdAt", "deletedAt", "futurePrivateSetting",
    ]) {
      assert.equal(Object.hasOwn(value, key), false, `${key} must not be public`);
    }
    // Assert the entire public contract, not just the absence of known secrets.
    assert.deepEqual(value, JSON.parse(JSON.stringify({
      id: webinar.id, title: webinar.title, description: webinar.description,
      videoProvider: webinar.videoProvider, coverImage: webinar.coverImage,
      startTime: webinar.startTime, status: webinar.status, publishStatus: webinar.publishStatus,
      videoDuration: webinar.videoDuration, scheduleMode: webinar.scheduleMode,
      recurringSchedule: webinar.recurringSchedule, timezone: webinar.timezone,
      brandSettings: webinar.brandSettings, customFields: webinar.customFields,
      scarcitySettings: webinar.scarcitySettings, thankYouSettings: webinar.thankYouSettings,
      replaySettings: webinar.replaySettings, replayEnabled: webinar.replayEnabled,
      replayAvailableHours: webinar.replayAvailableHours,
      metaPixelId: webinar.metaPixelId, gtmContainerId: webinar.gtmContainerId,
    })));
  }
  assertPublic((await read("/api/webinars"))[0]);
  for (const userId of [undefined, "privacy-unrelated"]) {
    assertPublic(await read(`/api/webinars/${webinar.id}`, userId));
    assertPublic((await read(`/api/webinars/${webinar.id}/landing-page`, userId)).webinar);
  }
  // Public landing responses remain public even if the owner is signed in.
  assertPublic((await read(`/api/webinars/${webinar.id}/landing-page`, webinar.userId!)).webinar);
  for (const userId of [webinar.userId!, "privacy-superadmin"]) {
    const managed = await read(`/api/webinars/${webinar.id}`, userId);
    assert.deepEqual(managed.notifySettings, webinar.notifySettings);
    assert.deepEqual(managed.emailSettings, webinar.emailSettings);
  }
  const managedList = await read("/api/webinars", webinar.userId!);
  assert.deepEqual(managedList[0].notifySettings, webinar.notifySettings);
  assert.deepEqual(managedList[0].emailSettings, webinar.emailSettings);
  const preview = await read(`/api/webinars/${webinar.id}/landing-page/preview`, webinar.userId!);
  assert.deepEqual(preview.webinar.notifySettings, webinar.notifySettings);
  assert.deepEqual(preview.webinar.emailSettings, webinar.emailSettings);
  // Serializing public responses must not delete fields on the stored object.
  assert.equal(webinar.notifySettings?.notifyEmail, "private-host@example.com");
});
