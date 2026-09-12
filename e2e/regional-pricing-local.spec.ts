import { expect, test, type Page, type Request } from "@playwright/test";

const pricingRegion = (countryCode: string | null, displayCurrency: "TWD" | "USD") => ({
  countryCode,
  displayCurrency,
  checkoutCurrency: "USD",
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("sellcase.marketing-consent.v1", "denied");
    localStorage.setItem("icta-lang", "zh-TW");
  });
});

test("Taiwan marketing prices show fixed TWD references and actual USD for month and year", async ({ page }) => {
  await page.route("**/api/pricing-region", route => route.fulfill({ json: pricingRegion("TW", "TWD") }));
  await page.goto("/");

  await expect(page.getByTestId("price-starter-month-primary")).toHaveText("約 NT$890／月");
  await expect(page.getByTestId("price-growth-month-usd")).toHaveText("實際結帳 US$99／月");
  await expect(page.getByTestId("price-scale-year-primary")).toHaveText("約 NT$61,200／年");
  await expect(page.getByTestId("price-scale-year-equivalent")).toHaveText("折合每月約 NT$5,100");
  await expect(page.getByTestId("price-starter-year-usd")).toHaveText("實際結帳 US$295.80／年（年繳預付）");
  await expect(page.getByTestId("pricing-currency-note")).toContainText("並非即時匯率");
  const consent = page.getByRole("dialog", { name: "Cookie 與行銷追蹤設定" });
  if (await consent.isVisible()) await consent.getByRole("button", { name: "僅使用必要功能" }).click();
  await page.screenshot({ path: "/tmp/regional-pricing-tw-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "/tmp/regional-pricing-tw-mobile.png", fullPage: true });

  await page.goto("/pricing");
  await expect(page.getByTestId("price-growth-month-primary")).toHaveText("約 NT$3,000／月");
  await expect(page.getByTestId("price-growth-year-primary")).toHaveText("約 NT$30,600／年");
});

test("non-Taiwan and unknown regions use USD primary prices without a client IP override", async ({ page }) => {
  for (const region of [pricingRegion("US", "USD"), pricingRegion("JP", "USD"), pricingRegion(null, "USD")]) {
    await page.route("**/api/pricing-region", route => route.fulfill({ json: region }));
    await page.goto("/");
    await expect(page.getByTestId("price-starter-month-primary")).toHaveText("US$29／月");
    await expect(page.getByTestId("price-growth-year-primary")).toHaveText("US$1,009.80／年");
    await expect(page.getByTestId("pricing-currency-note")).toHaveCount(0);
    await page.unroute("**/api/pricing-region");
  }
});

async function mockUpgradeDashboard(page: Page, subscriptionOverride: Record<string, unknown> = {}) {
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    const responses: Record<string, unknown> = {
      "/api/webinars": [],
      "/api/webinars/stats/summary": {},
      "/api/admin/subscription": {
        plan: "free", amountUsd: null, status: "inactive", active: false,
        planStartedAt: null, planExpiresAt: null, cancelAtPeriodEnd: false,
        addonWebinars: 0, maxWebinars: 0, webinarCount: 0, publishedCount: 0,
        isActive: false, isExpired: false, isSuperAdmin: false, hasStripeCustomer: false,
        ...subscriptionOverride,
      },
      "/api/stripe/config": {
        billingAvailable: true, catalogReady: true, publishableKey: "",
        plans: [
          { key: "starter", amountUsd: 29, annualAmountUsd: 295.8, includedWebinars: 1, monthlyRegistrants: 1000, monthlyAiPoints: 100, trialDays: 0, available: true, annualAvailable: true },
          { key: "growth", amountUsd: 99, annualAmountUsd: 1009.8, includedWebinars: 5, monthlyRegistrants: 3000, monthlyAiPoints: 200, trialDays: 0, available: true, annualAvailable: true },
          { key: "scale", amountUsd: 199, annualAmountUsd: 2029.8, includedWebinars: 15, monthlyRegistrants: 5000, monthlyAiPoints: 300, trialDays: 0, available: true, annualAvailable: true },
        ],
        addonAmountUsd: 20, annualAddonAmountUsd: 204,
      },
      "/api/ai-points": { points: 0, giftedPoints: 0, permanentPoints: 0, nextExpiry: null, nextExpiryPoints: 0, planMonthlyGift: 0, unlimited: false, packages: [] },
      "/api/trial": { eligibility: "ineligible", state: "ineligible", startsAt: null, expiresAt: null, retentionUntil: null, remainingAI: 0, usedAI: 0, milestones: [] },
      "/api/admin/ecpay-connection": null,
      "/api/products": [],
      "/api/product-sales-pages": [],
    };
    await route.fulfill({ json: responses[path] ?? {} });
  });
}

test("upgrade shows TWD references for both intervals but checkout remains USD planKey payload", async ({ page }) => {
  await mockUpgradeDashboard(page);
  await page.route("**/api/pricing-region", route => route.fulfill({ json: pricingRegion("TW", "TWD") }));
  let checkout: Request | undefined;
  await page.route("**/api/stripe/checkout", route => {
    checkout = route.request();
    return route.fulfill({ json: { url: "/checkout-mock" } });
  });
  await page.goto("/admin/dashboard");
  await page.getByTestId("button-upgrade").click();
  const dialog = page.getByRole("dialog", { name: "選擇發布方案" });
  await expect(dialog.getByTestId("price-starter-month-primary")).toHaveText("約 NT$890／月");
  await expect(dialog.getByTestId("checkout-currency-confirmation")).toContainText("結帳幣別：USD");

  await dialog.getByRole("button", { name: /年繳/ }).click();
  await expect(dialog.getByTestId("price-starter-year-primary")).toHaveText("約 NT$9,078／年");
  await expect(dialog.getByTestId("checkout-currency-confirmation")).toContainText("US$295.80");
  await dialog.getByRole("button", { name: "前往 Stripe 安全結帳" }).click();
  await expect.poll(() => checkout?.postDataJSON()).toEqual({
    planKey: "starter",
    billingInterval: "year",
    addonWebinars: 0,
  });
});

test("old subscriber keeps the actual current USD bill and opens the existing Stripe portal", async ({ page }) => {
  await mockUpgradeDashboard(page, {
    plan: "starter",
    amountUsd: 39,
    status: "active",
    active: true,
    isActive: true,
    maxWebinars: 1,
    hasStripeCustomer: true,
    paid: {
      plan: "starter", amountUsd: 39, status: "active", active: true,
      planStartedAt: "2025-01-01T00:00:00.000Z", planExpiresAt: null,
      cancelAtPeriodEnd: false, stripeSubscriptionId: "sub_old",
    },
  });
  await page.route("**/api/pricing-region", route => route.fulfill({ json: pricingRegion("US", "USD") }));
  let portalRequest: Request | undefined;
  await page.route("**/api/stripe/portal", route => {
    portalRequest = route.request();
    return route.fulfill({ json: { url: "/portal-mock" } });
  });
  await page.goto("/admin/dashboard");
  await expect(page.getByTestId("badge-current-plan")).toContainText("$39 Starter");
  await expect(page.getByTestId("button-upgrade")).toHaveText("變更方案／增加額度");
  await page.getByTestId("button-upgrade").click();
  await expect.poll(() => portalRequest?.postDataJSON()).toEqual({});
});