import { expect, test } from "@playwright/test";

const webinar = {
  id: "landing-local",
  title: "SellCase conversion moment",
  description: "A focused Taiwanese webinar.",
  publishStatus: "published",
  startTime: new Date(Date.now() + 86_400_000).toISOString(),
  timezone: "Asia/Taipei",
  customFields: [],
  scarcitySettings: { countdownEnabled: false, seatsEnabled: false, totalSeats: 0, urgencyText: "" },
};

const landingPage = {
  version: 3,
  status: "published",
  brandSettings: { primaryColor: "#0f766e", secondaryColor: "#f59e0b", backgroundColor: "#f5f8f6" },
  blocks: [
    { id: "hero", type: "hero", enabled: true, headline: "先看懂，再決定", subheadline: "準備好你的下一步。", ctaLabel: "立即報名" },
    { id: "video", type: "video", enabled: true, provider: "youtube", videoId: "dQw4w9WgXcQ", headline: "一分鐘認識活動" },
    { id: "sticky", type: "stickyCta", enabled: true, headline: "明天開播", ctaLabel: "保留席位", countdownMode: "webinarStart" },
  ],
};
const editorLandingPage = { ...landingPage, blocks: [landingPage.blocks[0]] };

async function mockLanding(page: import("@playwright/test").Page) {
  await page.route("**/api/webinars/landing-local/landing-page/preview", (route) => route.fulfill({ json: { landingPage: editorLandingPage } }));
  await page.route("**/api/webinars/landing-local/landing-page", (route) => route.fulfill({ json: { landingPage } }));
  await page.route("**/api/webinars/landing-local", (route) => route.fulfill({ json: webinar }));
  await page.route("**/api/webinars/landing-local/available-sessions", (route) => route.fulfill({ json: { mode: "fixed", sessions: [], hasSessions: false, registrationOpen: true } }));
  await page.route("**/api/webinars/landing-local/registration-count", (route) => route.fulfill({ json: { count: 4 } }));
}

test.describe("Landing Studio local mocked behavior", () => {
  test("exposes video and singleton sticky CTA tools", async ({ page }) => {
    await mockLanding(page);
    await page.goto("/admin/webinar/landing-local/landing-page");
    await expect(page.getByText("頁面結構")).toBeVisible();
    await page.getByRole("button", { name: "新增" }).click();
    await expect(page.getByRole("button", { name: "嵌入影片", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "固定倒數 CTA", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "嵌入影片", exact: true }).click();
    const videoInput = page.getByLabel("YouTube / Vimeo 網址或影片 ID");
    await expect(page.getByText("貼上有效的 YouTube 或 Vimeo 網址後顯示預覽")).toBeVisible();
    await videoInput.fill("https://youtu.be/");
    await expect(videoInput).toHaveValue("https://youtu.be/");
    await videoInput.fill("https://youtu.be/dQw4w9WgXcQ");
    await expect(page.locator('iframe[src*="youtube-nocookie.com/embed/dQw4w9WgXcQ"]')).toBeVisible();
    await page.getByRole("button", { name: "新增" }).click();
    await page.getByRole("button", { name: "固定倒數 CTA", exact: true }).click();
    await page.getByRole("button", { name: "新增" }).click();
    await expect(page.getByRole("button", { name: "固定倒數 CTA", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "編輯固定倒數 CTA" })).toHaveCount(1);
  });

  test("stores fixed countdowns in the webinar timezone", async ({ page }) => {
    await mockLanding(page);
    await page.route("**/api/webinars/landing-local/landing-page/preview", (route) => route.fulfill({
      json: {
        landingPage: {
          ...editorLandingPage,
          blocks: [
            editorLandingPage.blocks[0],
            {
              id: "sticky-fixed",
              type: "stickyCta",
              enabled: true,
              headline: "台北場即將開始",
              ctaLabel: "立即報名",
              countdownMode: "fixed",
              targetAt: "2026-09-10T01:30:00.000Z",
            },
          ],
        },
      },
    }));
    await page.goto("/admin/webinar/landing-local/landing-page");
    await page.getByRole("button", { name: "編輯固定倒數 CTA" }).click();
    const target = page.getByLabel("固定截止時間（Asia/Taipei）");
    await expect(target).toHaveValue("2026-09-10T09:30");
    await target.fill("2026-09-10T10:30");
    const requestPromise = page.waitForRequest((request) =>
      request.method() === "PATCH" && request.url().endsWith("/api/webinars/landing-local/landing-page")
    );
    await page.getByRole("button", { name: "儲存草稿" }).click();
    const request = await requestPromise;
    const sticky = request.postDataJSON().blocks.find((block: { type: string }) => block.type === "stickyCta");
    expect(sticky.targetAt).toBe("2026-09-10T02:30:00.000Z");
  });

  test("keeps legacy published webinars open when no landing snapshot exists", async ({ page }) => {
    await mockLanding(page);
    await page.route("**/api/webinars/landing-local/landing-page", (route) => route.fulfill({
      status: 404,
      json: { message: "說明會落地頁尚未發布" },
    }));
    await page.goto("/form/landing-local");
    const consent = page.getByRole("dialog", { name: "Cookie 與行銷追蹤設定" });
    if (await consent.isVisible()) await consent.getByRole("button", { name: "僅使用必要功能" }).click();
    await expect(page.getByText("以下仍可完成報名")).toBeVisible();
    await expect(page.getByTestId("input-name")).toBeVisible();
  });

  for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
    test(`renders privacy video and usable sticky CTA at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await mockLanding(page);
      await page.goto("/form/landing-local");
      const consent = page.getByRole("dialog", { name: "Cookie 與行銷追蹤設定" });
      if (await consent.isVisible()) await consent.getByRole("button", { name: "僅使用必要功能" }).click();
      await expect(page.locator('iframe[src*="youtube-nocookie.com/embed/dQw4w9WgXcQ"]')).toBeVisible();
      const sticky = page.locator(".webinar-sticky-cta");
      await expect(sticky).toBeVisible();
      await expect(sticky).toHaveCSS("position", "fixed");
      const box = await sticky.boundingBox();
      expect(box).not.toBeNull();
      expect((box?.y || 0) + (box?.height || 0)).toBeGreaterThan(viewport.height - 24);
      expect(await page.locator(".registration-page").evaluate((node) => Number.parseFloat(getComputedStyle(node).paddingBottom))).toBeGreaterThan(0);
      await sticky.getByRole("button", { name: "保留席位" }).click();
      await expect(page.getByTestId("input-name")).toBeFocused();
      await page.getByTestId("button-register").scrollIntoViewIfNeeded();
      const submitBox = await page.getByTestId("button-register").boundingBox();
      const finalStickyBox = await sticky.boundingBox();
      expect(submitBox).not.toBeNull();
      expect(finalStickyBox).not.toBeNull();
      expect((submitBox?.y || 0) + (submitBox?.height || 0)).toBeLessThanOrEqual((finalStickyBox?.y || 0) + 1);
    });
  }
});