import { expect, test } from "@playwright/test";

const webinar = {
  id: "local-e2e-webinar",
  title: "Local E2E viewer",
  publishStatus: "published",
  vimeoUrl: "https://vimeo.com/123456789",
  startTime: "2020-01-01T00:00:00.000Z",
  timezone: "UTC",
  replayEnabled: true,
  replayAvailableHours: 48,
};

async function mockWebinar(page: import("@playwright/test").Page, watchState: object | null, status = 200) {
  await page.route("**/api/webinars/local-e2e", (route) => route.fulfill({ json: webinar }));
  await page.route("**/api/webinars/local-e2e/watch-state**", (route) =>
    watchState === null
      ? route.abort("failed")
      : route.fulfill({ status, contentType: "application/json", body: JSON.stringify(watchState) }),
  );
}

test.describe("local mocked viewer safety flows", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
  });

  test("gates marketing tracking behind explicit consent", async ({ page }) => {
    await mockWebinar(page, {
      registrationId: "local-registration",
      canWatch: false,
      accessRevoked: true,
    });
    await page.goto("/webinar/local-e2e?watchToken=local-token", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("dialog", { name: "Cookie 與行銷追蹤設定" })).toBeVisible();
    await expect(page.getByRole("button", { name: "同意行銷追蹤" })).toBeVisible();
    await page.getByRole("button", { name: "僅使用必要功能" }).click();
    await expect(page.getByRole("dialog", { name: "Cookie 與行銷追蹤設定" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "開啟 Cookie 與行銷追蹤設定" })).toBeVisible();
  });

  test("renders revoked state and never creates a stale Vimeo iframe", async ({ page }) => {
    await mockWebinar(page, {
      registrationId: "local-registration",
      canWatch: false,
      accessRevoked: true,
    });
    await page.goto("/webinar/local-e2e?watchToken=local-token", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("觀看資格已失效", { exact: true })).toBeVisible();
    await expect(page.getByTestId("video-player")).toHaveCount(0);
  });

  test("renders temporary verification failure without falling back to stale Vimeo playback", async ({ page }) => {
    await mockWebinar(page, null);
    await page.goto("/webinar/local-e2e?watchToken=local-token", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("暫時無法確認資格", { exact: true })).toBeVisible();
    await expect(page.getByTestId("video-player")).toHaveCount(0);
  });
});