import { test, expect, type Page } from "@playwright/test";

async function mockDashboard(page: Page, superAdmin = true) {
  await page.addInitScript(() => {
    localStorage.setItem("sellcase.marketing-consent.v1", "denied");
    localStorage.setItem("icta-lang", "zh-TW");
  });
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    const responses: Record<string, unknown> = {
      "/api/webinars": [],
      "/api/webinars/stats/summary": {},
      "/api/admin/subscription": {
        plan: "growth", amountUsd: 99, status: "active", active: true,
        planStartedAt: null, planExpiresAt: null, cancelAtPeriodEnd: false,
        addonWebinars: 0, maxWebinars: 5, webinarCount: 0, publishedCount: 0,
        isActive: true, isExpired: false, isSuperAdmin: superAdmin, hasStripeCustomer: false,
      },
      "/api/stripe/config": { billingAvailable: false, catalogReady: false, plans: [], publishableKey: "" },
      "/api/ai-points": { points: 100, unlimited: superAdmin, giftedPoints: 100, permanentPoints: 0, packages: [] },
      "/api/admin/ecpay-connection": null,
      "/api/admin/logout": { success: true },
      "/api/products": [],
      "/api/product-sales-pages": [],
      "/api/media": { assets: [], usage: { videoBytes: 0, maxVideoBytes: 0 } },
      "/api/media/config": { videoEnabled: false, imageEnabled: false },
    };
    await route.fulfill({ json: responses[path] ?? {} });
  });
}

test("mobile menu preserves actions, language and dialog focus", async ({ page }) => {
  await mockDashboard(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/dashboard");
  const trigger = page.getByTestId("button-admin-mobile-menu");
  await expect(trigger).toBeVisible();
  await expect(page.getByTestId("admin-desktop-navigation")).toBeHidden();
  await trigger.click();
  const menu = page.getByRole("dialog", { name: "後台選單", exact: true });
  await expect(menu).toBeVisible();
  await expect(page.getByTestId("mobile-button-super-admin")).toBeVisible();
  await menu.screenshot({ path: "/tmp/admin-mobile-menu.png" });
  await page.keyboard.press("Escape");
  await expect(menu).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.getByTestId("mobile-button-open-support").click();
  const support = page.getByRole("dialog", { name: "聯繫客服團隊" });
  await expect(support).toBeVisible();
  await expect(menu).not.toBeVisible();
  await expect.poll(() => support.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await trigger.click();
  await page.getByTestId("mobile-button-open-ecpay").click();
  await expect(page.getByRole("dialog", { name: "綠界 ECPay 自有商店" })).toBeVisible();
  await page.keyboard.press("Escape");
  await trigger.click();
  await page.getByTestId("mobile-button-admin-lang-toggle").click();
  await expect(trigger).toHaveAttribute("aria-label", "开启后台选单");
  await trigger.click();
  await expect(page.getByRole("dialog", { name: "后台选单", exact: true })).toBeVisible();
  await page.getByTestId("mobile-button-products").click();
  await expect(page).toHaveURL(/\/admin\/products$/);
});

test("regular members do not see super-admin action; desktop stays inline", async ({ page }) => {
  await mockDashboard(page, false);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/dashboard");
  await page.getByTestId("button-admin-mobile-menu").click();
  await expect(page.getByTestId("mobile-button-super-admin")).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.getByRole("dialog", { name: "後台選單", exact: true })).not.toBeVisible();
  await expect(page.getByTestId("button-admin-mobile-menu")).toBeHidden();
  await expect(page.getByTestId("button-products")).toBeVisible();
  await expect(page.getByTestId("button-media-library")).toBeVisible();
  await expect(page.getByTestId("button-logout")).toBeVisible();
});

test("mobile media, super-admin and logout actions keep original behavior", async ({ page }) => {
  await mockDashboard(page);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [action, destination] of [
    ["mobile-button-media-library", "/admin/media"],
    ["mobile-button-super-admin", "/super-admin"],
    ["mobile-button-logout", "/admin"],
  ]) {
    await page.goto("/admin/dashboard");
    await page.getByTestId("button-admin-mobile-menu").click();
    await page.getByTestId(action).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe(destination);
  }
});