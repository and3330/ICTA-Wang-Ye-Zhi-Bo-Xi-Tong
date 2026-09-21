import { test, expect, type Page } from "@playwright/test";

async function mockDashboard(
  page: Page,
  superAdmin = true,
  subscriptionOverride: Record<string, unknown> = {},
) {
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
        ...subscriptionOverride,
      },
      "/api/stripe/config": { billingAvailable: false, catalogReady: false, plans: [], publishableKey: "" },
      "/api/ai-points": { points: 100, unlimited: superAdmin, giftedPoints: 100, permanentPoints: 0, packages: [] },
      "/api/admin/ecpay-connection": null,
      "/api/admin/logout": { success: true },
      "/api/products": [],
      "/api/product-sales-pages": [],
      "/api/media": { assets: [], usage: { videoBytes: 0, maxVideoBytes: 0 } },
      "/api/media/config": { videoEnabled: false, imageEnabled: false },
      "/api/member/external-orders": { items: [], total: 0, page: 1, pageSize: 25 },
      "/api/member/external-orders/summary": { currencies: [] },
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

test("regular members do not see super-admin action; desktop shows the four primary areas", async ({ page }) => {
  await mockDashboard(page, false);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/dashboard");
  await page.getByTestId("button-admin-mobile-menu").click();
  await expect(page.getByTestId("mobile-button-super-admin")).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.getByRole("dialog", { name: "後台選單", exact: true })).not.toBeVisible();
  await expect(page.getByTestId("button-admin-mobile-menu")).toBeHidden();
  await expect(page.getByTestId("button-products")).toHaveText("電商賣場管理");
  await expect(page.getByTestId("button-orders")).toHaveText("訂單管理系統");
  await expect(page.getByTestId("button-media-library")).toHaveText("素材庫");
  await expect(page.getByTestId("button-logout")).not.toBeVisible();
  await page.getByTestId("button-admin-settings").click();
  await expect(page.getByTestId("button-super-admin")).toHaveCount(0);
  await expect(page.getByTestId("button-logout")).toBeVisible();
});

test("desktop primary navigation and settings preserve operations and dialog focus", async ({ page }) => {
  await mockDashboard(page);
  await page.setViewportSize({ width: 1024, height: 850 });
  await page.goto("/admin/dashboard");
  const nav = page.getByTestId("admin-desktop-navigation");
  await expect(nav.locator(":scope > button")).toHaveText(["說明會管理", "電商賣場管理", "訂單管理系統", "素材庫", "工作台選單"]);
  await expect(page.getByTestId("button-webinars")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("button-admin-settings")).toContainText("工作台選單");
  await expect(page.getByTestId("button-open-ecpay")).not.toBeVisible();
  const settings = page.getByTestId("button-admin-settings");
  await settings.click();
  await expect(page.getByTestId("button-super-admin")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(settings).toBeFocused();
  await settings.click();
  await page.getByTestId("button-open-support").click();
  const support = page.getByRole("dialog", { name: "聯繫客服團隊" });
  await expect(support).toBeVisible();
  await expect.poll(() => support.evaluate(el => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await settings.click();
  await page.getByTestId("button-open-ecpay").click();
  await expect(page.getByRole("dialog", { name: "綠界 ECPay 自有商店" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.locator(".admin-dashboard > header").screenshot({ path: "/tmp/admin-nav-desktop.png" });
  await settings.click();
  await page.getByRole("menu").screenshot({ path: "/tmp/admin-nav-settings.png" });
});

test("commerce, orders, and media share the same header and current-page navigation", async ({ page }) => {
  await mockDashboard(page, false);
  await page.route("**/api/member/orders**", route => route.fulfill({ json: { items: [], total: 0, currencies: [] } }));
  for (const [path, title, current] of [
    ["/admin/products", "電商賣場管理", "電商賣場管理"],
    ["/admin/orders", "訂單管理系統", "訂單管理系統"],
    ["/admin/orders?tab=external", "訂單管理系統", "訂單管理系統"],
    ["/admin/media", "素材庫", "素材庫"],
  ]) {
    await page.goto(path);
    await expect(page.locator(".admin-shell > header").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "工作台主要功能" }).getByRole("button", { name: current, exact: true })).toHaveAttribute("aria-current", "page");
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/products");
  await page.getByRole("button", { name: "開啟工作台選單" }).click();
  await expect(page.getByRole("menuitem", { name: "電商賣場管理" })).toHaveAttribute("aria-current", "page");
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

for (const hasStripeCustomer of [false, true]) {
  test(`manual effective access with ${hasStripeCustomer ? "a stale Stripe customer" : "no Stripe customer"} opens catalog, not billing portal`, async ({ page }) => {
    let portalRequests = 0;
    page.on("request", request => {
      if (new URL(request.url()).pathname === "/api/stripe/portal") portalRequests += 1;
    });
    await mockDashboard(page, false, {
      plan: "growth",
      active: true,
      planStartedAt: "2026-10-01T01:30:00.000Z",
      planExpiresAt: "2026-11-01T01:30:00.000Z",
      hasStripeCustomer,
      effectivePlan: {
        plan: "growth", source: "manual", active: true, maxWebinars: 5,
        monthlyRegistrants: 500, manualExpiresAt: "2026-11-01T01:30:00.000Z",
      },
      manualPlan: {
        id: "manual-1", userId: "member-1", plan: "growth", state: "active",
        startsAt: "2026-10-01T01:30:00.000Z", expiresAt: "2026-11-01T01:30:00.000Z",
        revokedAt: null, revokedBy: null, reason: "客服補償", version: 1,
        createdAt: "2026-10-01T01:30:00.000Z", createdBy: "root", updatedAt: "2026-10-01T01:30:00.000Z",
      },
      paid: {
        plan: "free", status: "inactive", active: false, planStartedAt: null,
        planExpiresAt: null, cancelAtPeriodEnd: false, amountUsd: null, stripeSubscriptionId: null,
      },
    });
    await page.goto("/admin/dashboard");
    await expect(page.getByText("Growth", { exact: true })).toBeVisible();
    await expect(page.getByTestId("badge-current-plan")).toHaveText("Growth");
    await expect(page.getByText("人工授權到期日")).toHaveCount(0);
    await expect(page.getByTestId("button-end-trial")).toHaveCount(0);
    await expect(page.getByTestId("button-manage-subscription")).toHaveCount(0);
    await page.getByTestId("button-account-actions").click();
    await page.getByTestId("button-upgrade").click();
    await expect(page.getByRole("dialog", { name: "選擇發布方案" })).toBeVisible();
    expect(portalRequests).toBe(0);
  });
}

test("legacy dashboard subscription fixture remains usable without paid object", async ({ page }) => {
  await mockDashboard(page, false);
  await page.goto("/admin/dashboard");
  await expect(page.getByText("Stripe 下次續訂日")).toHaveCount(0);
  await page.getByTestId("button-account-actions").click();
  await expect(page.getByTestId("button-upgrade")).toHaveText("變更方案／增加額度");
  await expect(page.getByTestId("text-ai-points")).toHaveCount(1);
  await expect(page.getByTestId("text-published-count")).toHaveCount(1);
});