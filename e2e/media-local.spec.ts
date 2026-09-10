import { expect, test, type Page, type Request } from "@playwright/test";

const GB = 1024 ** 3;
const config = {
  videoEnabled: true,
  imageEnabled: true,
  playbackEnabled: true,
  maxVideoBytes: 2 * GB,
  maxImageBytes: 5 * 1024 ** 2,
  maxTotalVideoBytes: 10 * GB,
};
const readyVideo = {
  id: "11111111-1111-4111-8111-111111111111",
  kind: "video",
  provider: "bunny_stream",
  name: "產品示範完整版.mp4",
  status: "ready",
  sizeBytes: 25 * 1024 ** 2,
  durationSeconds: 92,
  thumbnailUrl: "/mock-media/video.jpg",
  createdAt: "2026-09-10T01:00:00.000Z",
};
const processingVideo = {
  ...readyVideo,
  id: "22222222-2222-4222-8222-222222222222",
  name: "處理中的課程.mp4",
  status: "processing",
  thumbnailUrl: undefined,
};
const readyImage = {
  id: "33333333-3333-4333-8333-333333333333",
  kind: "image",
  provider: "bunny_storage",
  name: "銷售頁首圖.png",
  status: "ready",
  sizeBytes: 2048,
  url: "/mock-media/banner.png",
  createdAt: "2026-09-09T01:00:00.000Z",
};

async function mockMedia(page: Page, assets: any[] = [], override = config) {
  await page.route("**/api/media/config", route => route.fulfill({ json: override }));
  await page.route("**/api/media", route => route.fulfill({
    json: {
      assets,
      usage: {
        videoBytes: assets.filter(asset => asset.kind === "video" && asset.status !== "failed")
          .reduce((total, asset) => total + asset.sizeBytes, 0),
        maxVideoBytes: config.maxTotalVideoBytes,
      },
    },
  }));
  await page.route("**/mock-media/*", route => route.fulfill({
    contentType: "image/png",
    body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
  }));
}

test.describe("Owned media local mocked behavior", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("sellcase.marketing-consent.v1", "denied"));
  });

  test("shows empty, list, type filters, processing state, and API errors", async ({ page }) => {
    await mockMedia(page);
    await page.goto("/admin/media");
    await expect(page.getByRole("heading", { name: "媒體素材庫" })).toBeVisible();
    await expect(page.getByText("尚無素材")).toBeVisible();

    await page.unroute("**/api/media");
    await mockMedia(page, [readyVideo, processingVideo, readyImage]);
    await page.reload();
    await expect(page.getByTestId(`media-asset-${readyVideo.id}`)).toBeVisible();
    await expect(page.getByTestId(`media-status-${processingVideo.id}`)).toHaveText("處理中");
    await page.getByTestId("select-media-filter").click();
    await page.getByRole("option", { name: "圖片" }).click();
    await expect(page.getByTestId(`media-asset-${readyImage.id}`)).toBeVisible();
    await expect(page.getByTestId(`media-asset-${readyVideo.id}`)).toHaveCount(0);
    await page.getByTestId("select-media-filter").click();
    await page.getByRole("option", { name: "影片" }).click();
    await expect(page.getByTestId(`media-asset-${processingVideo.id}`)).toBeVisible();
    await expect(page.getByTestId(`media-asset-${readyImage.id}`)).toHaveCount(0);

    await page.route(`**/api/media/${processingVideo.id}/refresh`, route =>
      route.fulfill({ status: 502, json: { message: "Bunny 狀態服務暫時無法使用" } }),
    );
    await page.getByTestId(`media-asset-${processingVideo.id}`).getByRole("button", { name: "更新狀態" }).click();
    await expect(page.locator("[data-component-name='ToastDescription']").filter({ hasText: "Bunny 狀態服務暫時無法使用" }).first()).toBeVisible();
  });

  test("requires explicit legacy-image confirmation and reports migration results", async ({ page }) => {
    await mockMedia(page, [readyImage]);
    let migrationRequest: Request | undefined;
    await page.route("**/api/media/migrate-images", async route => {
      migrationRequest = route.request();
      await route.fulfill({
        json: {
          examined: 3,
          migrated: 2,
          errors: [{ id: "legacy-image-3", name: "舊版破損圖片.png", message: "Copy verification failed" }],
        },
      });
    });
    await page.goto("/admin/media");
    await page.getByTestId("button-migrate-legacy-images").click();
    const confirmation = page.getByRole("alertdialog");
    await expect(confirmation.getByRole("heading", { name: "將舊圖片複製到 Bunny？" })).toBeVisible();
    await expect(confirmation).toContainText("原始檔案與既有網址都會保留");
    expect(migrationRequest).toBeUndefined();
    await page.getByTestId("button-confirm-migrate-legacy-images").click();
    await expect.poll(() => migrationRequest?.postDataJSON()).toEqual({ limit: 50 });
    const result = page.getByTestId("dialog-migration-result");
    await expect(result).toBeVisible();
    await expect(page.getByTestId("text-migration-examined")).toHaveText("3");
    await expect(page.getByTestId("text-migration-count")).toHaveText("2");
    await expect(page.getByTestId("list-migration-errors")).toContainText("舊版破損圖片.png");
    await expect(page.getByTestId("list-migration-errors")).toContainText("Copy verification failed");
    await expect(result).toContainText("所有原始檔案及原網址均已保留");
  });

  test("explains missing playback setup and disables upload when no provider is configured", async ({ page }) => {
    await mockMedia(page, [], { ...config, playbackEnabled: false });
    await page.goto("/admin/media");
    await expect(page.getByTestId("media-playback-setup-notice")).toContainText("安全播放尚未設定");
    await expect(page.getByTestId("button-media-upload")).toBeEnabled();

    await page.unroute("**/api/media/config");
    await page.route("**/api/media/config", route => route.fulfill({
      json: { ...config, videoEnabled: false, imageEnabled: false, playbackEnabled: false },
    }));
    await page.reload();
    await expect(page.getByTestId("button-media-upload")).toBeDisabled();
  });

  test("fits the complete media controls at 390px without horizontal overflow", async ({ page }) => {
    await mockMedia(page, [readyVideo, processingVideo, readyImage]);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/admin/media");
    await expect(page.getByTestId(`media-asset-${readyVideo.id}`)).toBeVisible();
    await page.screenshot({ path: "/tmp/bunny-media-desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId("button-media-upload")).toBeInViewport();
    await expect(page.getByTestId("select-media-filter")).toBeVisible();
    expect(await page.evaluate(() => ({
      document: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      body: document.body.scrollWidth <= document.body.clientWidth,
    }))).toEqual({ document: true, body: true });
    await page.screenshot({ path: "/tmp/bunny-media-mobile.png", fullPage: true });
  });

  test("creates a mocked TUS upload, reports progress, and pauses without live network", async ({ page }) => {
    await mockMedia(page);
    const assetId = "44444444-4444-4444-8444-444444444444";
    let createRequest: Request | undefined;
    const tusRequests: Request[] = [];
    await page.route("**/api/media/videos", async route => {
      createRequest = route.request();
      await route.fulfill({
        status: 201,
        json: {
          asset: { ...processingVideo, id: assetId, name: "upload-progress.mp4", status: "uploading", sizeBytes: 256 * 1024 },
          upload: {
            endpoint: "https://video.bunnycdn.com/tusupload",
            headers: {
              AuthorizationSignature: "local-fake-signature",
              AuthorizationExpire: "1999999999",
              VideoId: "55555555-5555-4555-8555-555555555555",
              LibraryId: "12345",
            },
            expiresAt: "2030-01-01T00:00:00.000Z",
          },
        },
      });
    });
    await page.route(`**/api/media/${assetId}`, route => route.fulfill({ json: { success: true } }));
    await page.route("https://video.bunnycdn.com/tusupload", async route => {
      tusRequests.push(route.request());
      await route.fulfill({
        status: 201,
        headers: {
          Location: "https://video.bunnycdn.com/tusupload/local-upload",
          "Tus-Resumable": "1.0.0",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Expose-Headers": "Location, Tus-Resumable",
        },
      });
    });
    await page.route("https://video.bunnycdn.com/tusupload/local-upload", async route => {
      tusRequests.push(route.request());
      if (route.request().method() === "DELETE") {
        return route.fulfill({
          status: 204,
          headers: { "Tus-Resumable": "1.0.0", "Access-Control-Allow-Origin": "*" },
        });
      }
      // Keep the fake PATCH pending so the UI can exercise cancellation.
      await new Promise(resolve => setTimeout(resolve, 3_000));
      await route.abort();
    });

    await page.goto("/admin/media");
    await page.getByTestId("input-media-upload").setInputFiles({
      name: "upload-progress.mp4",
      mimeType: "video/mp4",
      buffer: Buffer.alloc(256 * 1024, 7),
    });
    await expect.poll(() => createRequest?.postDataJSON()).toEqual({
      name: "upload-progress.mp4",
      sizeBytes: 256 * 1024,
      contentType: "video/mp4",
    });
    const upload = page.getByTestId(`media-upload-${assetId}`);
    await expect(upload).toBeVisible();
    await expect.poll(() => tusRequests.map(request => request.method())).toContain("PATCH");
    await expect(upload.getByText(/%$/)).toBeVisible();
    await page.getByTestId(`button-upload-pause-${assetId}`).click();
    await expect(upload.getByText("已暫停，可繼續上傳")).toBeVisible();
    await expect(page.getByTestId(`button-upload-resume-${assetId}`)).toBeVisible();
    await page.getByTestId(`button-upload-cancel-${assetId}`).click();
    await expect(upload).toHaveCount(0);
  });

  test("switches create form from Vimeo to a ready owned video and back", async ({ page }) => {
    const webinarRequests: Request[] = [];
    await page.route("**/api/**", route => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/media") return route.fulfill({
        json: { assets: [readyVideo, processingVideo, readyImage], usage: { videoBytes: 1, maxVideoBytes: config.maxTotalVideoBytes } },
      });
      if (path === "/api/webinars" && route.request().method() === "POST") {
        webinarRequests.push(route.request());
        return route.fulfill({ status: 201, json: { id: "created-webinar", ...route.request().postDataJSON() } });
      }
      if (path === "/api/webinars") return route.fulfill({ json: [] });
      if (path === "/api/admin/subscription") return route.fulfill({
        json: { isSuperAdmin: false, isActive: true, isExpired: false, hasStripeCustomer: false },
      });
      if (path === "/api/stripe/config") return route.fulfill({
        json: { publishableKey: "", billingAvailable: false, catalogReady: false, plans: [], addonAmountUsd: 20, annualAddonAmountUsd: 204 },
      });
      if (path === "/api/ai-points") return route.fulfill({
        json: { points: 0, unlimited: false, packages: [] },
      });
      if (path.includes("stats")) return route.fulfill({ json: {} });
      return route.fulfill({ json: [] });
    });
    await page.goto("/admin/dashboard");
    await page.getByTestId("button-create-first-webinar").click();
    await expect(page.getByTestId("input-source-vimeo-url")).toBeVisible();
    await page.getByTestId("input-source-vimeo-url").fill("https://vimeo.com/123456789");
    await page.getByTestId("button-source-bunny").click();
    const picker = page.getByTestId("dialog-video-media-picker");
    await expect(picker.getByText(readyVideo.name)).toBeVisible();
    await expect(picker.getByText(processingVideo.name)).toHaveCount(0);
    await picker.getByTestId(`media-picker-item-${readyVideo.id}`).click();
    await expect(page.getByTestId("input-source-vimeo-url")).toHaveCount(0);
    await page.getByTestId("button-source-vimeo").click();
    await expect(page.getByTestId("input-source-vimeo-url")).toBeVisible();
  });

  test("edits an existing Vimeo webinar to an owned-video source with the typed payload", async ({ page }) => {
    const webinar = {
      id: "media-edit-webinar",
      title: "既有 Vimeo 說明會",
      description: "切換來源回歸測試",
      vimeoUrl: "https://vimeo.com/987654321",
      videoProvider: "vimeo",
      videoAssetId: null,
      startTime: "2026-09-11T01:00:00.000Z",
      publishStatus: "draft",
      status: "scheduled",
      timezone: "Asia/Taipei",
      customFields: [],
      scarcitySettings: {},
      scheduleMode: { recurring: false, onDemand: false, justInTime: false, justInTimeMinutes: 15 },
    };
    let updateRequest: Request | undefined;
    await page.route("**/api/**", async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === "/api/media") {
        return route.fulfill({
          json: { assets: [readyVideo, processingVideo], usage: { videoBytes: 1, maxVideoBytes: config.maxTotalVideoBytes } },
        });
      }
      if (path === `/api/webinars/${webinar.id}`) {
        if (request.method() === "PATCH") {
          updateRequest = request;
          return route.fulfill({ json: { ...webinar, ...request.postDataJSON() } });
        }
        return route.fulfill({ json: webinar });
      }
      if (path.includes("analytics")) return route.fulfill({ json: {} });
      if (path.includes("lead-insights")) return route.fulfill({ json: { leads: [], total: 0 } });
      return route.fulfill({ json: [] });
    });

    await page.goto(`/admin/webinar/${webinar.id}`);
    await expect(page.getByRole("heading", { name: webinar.title })).toBeVisible();
    await page.getByTestId("button-edit-info").click();
    await expect(page.getByTestId("input-source-vimeo-url")).toHaveValue(webinar.vimeoUrl);
    await page.getByTestId("button-source-bunny").click();
    await page.getByTestId(`media-picker-item-${readyVideo.id}`).click();
    await page.getByTestId("button-save-info").click();
    await expect.poll(() => updateRequest?.postDataJSON()).toMatchObject({
      title: webinar.title,
      vimeoUrl: "",
      videoProvider: "bunny",
      videoAssetId: readyVideo.id,
    });
  });

  test("normalizes raw Vimeo share and unlisted-hash playback descriptors", async ({ page }) => {
    const errors: Error[] = [];
    page.on("pageerror", error => errors.push(error));
    await page.addInitScript(() => {
      class MockWebSocket {
        static OPEN = 1;
        readyState = 1;
        onopen: ((event: Event) => void) | null = null;
        onmessage: ((event: MessageEvent) => void) | null = null;
        onclose: ((event: CloseEvent) => void) | null = null;
        constructor() { setTimeout(() => this.onopen?.(new Event("open")), 0); }
        send() {}
        close() { this.readyState = 3; }
      }
      class MockVimeoPlayer {
        on() {}
        play() { return Promise.resolve(); }
        pause() { return Promise.resolve(); }
        setMuted() { return Promise.resolve(); }
        setVolume() { return Promise.resolve(); }
        getDuration() { return Promise.resolve(120); }
        getCurrentTime() { return Promise.resolve(0); }
        setCurrentTime(value: number) { return Promise.resolve(value); }
        destroy() { return Promise.resolve(); }
      }
      (window as any).Vimeo = { Player: MockVimeoPlayer };
      (window as any).WebSocket = MockWebSocket;
    });
    await page.route("https://player.vimeo.com/**", route =>
      route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Mock Vimeo iframe</title>" }),
    );
    await page.route("**/api/webinars/playback-vimeo/watch-state**", route => route.fulfill({
      json: {
        registrationId: "viewer-vimeo",
        canWatch: true,
        mode: "onDemand",
        playback: { provider: "vimeo", url: "https://vimeo.com/987654321/aB12cD" },
      },
    }));
    await page.route("**/api/webinars/playback-vimeo", route => route.fulfill({
      json: {
        id: "playback-vimeo",
        title: "Vimeo descriptor regression",
        publishStatus: "published",
        startTime: "2020-01-01T00:00:00.000Z",
        scheduleMode: { onDemand: true },
      },
    }));
    await page.goto("/webinar/playback-vimeo?watchToken=mock-vimeo-token");
    await page.getByTestId("input-nickname").fill("Vimeo viewer");
    await page.getByTestId("button-join").click();
    const src = await page.getByTestId("video-player").getAttribute("src");
    expect(src).toMatch(/^https:\/\/player\.vimeo\.com\/video\/987654321\?/);
    expect(new URL(src!).searchParams.get("h")).toBe("aB12cD");
    expect(errors).toEqual([]);
  });

  test("adapts Bunny callback Player.js, retains iframe across token rotation, and unmounts on revocation", async ({ page }) => {
    const errors: Error[] = [];
    page.on("pageerror", error => errors.push(error));
    await page.clock.install();
    await page.addInitScript(() => {
      const state = {
        events: {} as Record<string, Array<(value?: any) => void>>,
        calls: [] as Array<[string, unknown?]>,
      };
      (window as any).__bunnyPlayerState = state;
      class MockBunnyPlayer {
        on(name: string, callback: (value?: any) => void) {
          (state.events[name] ||= []).push(callback);
          if (name === "ready") setTimeout(() => callback(), 0);
        }
        off(name: string) {
          state.calls.push(["off", name]);
          delete state.events[name];
        }
        play() {
          state.calls.push(["play"]);
          state.events.play?.forEach(callback => callback());
          state.events.timeupdate?.forEach(callback => callback({ seconds: 17, duration: 120 }));
        }
        pause() {
          state.calls.push(["pause"]);
          state.events.pause?.forEach(callback => callback());
        }
        mute() { state.calls.push(["mute"]); }
        unmute() { state.calls.push(["unmute"]); }
        setVolume(value: number) { state.calls.push(["setVolume", value]); }
        getDuration(callback: (value: number) => void) { callback(120); }
        getCurrentTime(callback: (value: number) => void) { callback(0); }
        setCurrentTime(value: number) { state.calls.push(["setCurrentTime", value]); }
      }
      class MockWebSocket {
        static OPEN = 1;
        readyState = 1;
        onopen: ((event: Event) => void) | null = null;
        onmessage: ((event: MessageEvent) => void) | null = null;
        onclose: ((event: CloseEvent) => void) | null = null;
        constructor() { setTimeout(() => this.onopen?.(new Event("open")), 0); }
        send() {}
        close() { this.readyState = 3; }
      }
      (window as any).playerjs = { Player: MockBunnyPlayer };
      (window as any).WebSocket = MockWebSocket;
    });
    await page.route("https://iframe.mediadelivery.net/**", route =>
      route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Mock Bunny iframe</title>" }),
    );
    let watchRequests = 0;
    await page.route("**/api/webinars/playback-bunny/watch-state**", route => {
      watchRequests++;
      if (watchRequests >= 3) {
        return route.fulfill({ json: { registrationId: "viewer-bunny", canWatch: false, accessRevoked: true } });
      }
      const token = watchRequests === 1 ? "signed-token-one" : "signed-token-two";
      return route.fulfill({
        json: {
          registrationId: "viewer-bunny",
          canWatch: true,
          mode: "onDemand",
          playback: {
            provider: "bunny",
            assetId: readyVideo.id,
            videoId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            libraryId: "12345",
            embedUrl: `https://iframe.mediadelivery.net/embed/12345/video-id?token=${token}&expires=1999999999`,
            expiresAt: new Date(Date.now() + (watchRequests === 1 ? 31_000 : 61_000)).toISOString(),
          },
        },
      });
    });
    await page.route("**/api/webinars/playback-bunny", route => route.fulfill({
      json: {
        id: "playback-bunny",
        title: "Bunny callback regression",
        publishStatus: "published",
        startTime: "2020-01-01T00:00:00.000Z",
        scheduleMode: { onDemand: true },
      },
    }));
    await page.goto("/webinar/playback-bunny?watchToken=mock-bunny-token");
    await page.getByTestId("input-nickname").fill("Bunny viewer");
    await page.getByTestId("button-join").click();
    const player = page.getByTestId("video-player");
    await expect(player).toHaveAttribute("src", /signed-token-one/);
    await page.getByTestId("button-play-video").click();
    await expect(page.getByTestId("video-overlay-block")).toBeVisible();
    await expect.poll(() => page.evaluate(() => (window as any).__bunnyPlayerState.calls)).toEqual(
      expect.arrayContaining([["unmute"], ["setVolume", 100], ["play"]]),
    );

    await page.clock.fastForward(1_500);
    await expect.poll(() => watchRequests, { timeout: 8_000 }).toBeGreaterThanOrEqual(2);
    await expect(player).toHaveAttribute("src", /signed-token-one/);
    await expect(player).not.toHaveAttribute("src", /signed-token-two/);
    await page.evaluate(() => {
      (window as any).__bunnyPlayerState.events.error?.forEach((callback: () => void) => callback());
    });
    await expect(page.getByTestId("video-player-error")).toBeVisible();
    await page.getByTestId("video-player-retry").click();
    await expect(player).toHaveAttribute("src", /signed-token-two/);
    await page.clock.fastForward(61_000);
    await expect.poll(() => watchRequests, { timeout: 8_000 }).toBeGreaterThanOrEqual(3);
    await expect(player).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => (window as any).__bunnyPlayerState.calls)).toEqual(
      expect.arrayContaining([["pause"], ["off", "timeupdate"], ["off", "play"], ["off", "pause"], ["off", "ended"]]),
    );
    expect(errors).toEqual([]);
  });
});