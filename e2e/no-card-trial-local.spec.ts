import { expect, test, type Request } from "@playwright/test";

const trial = (state: "eligible" | "active" | "expired" | "upgraded", remainingAI = 50) => ({
  eligibility: state === "eligible" ? "eligible" : "active",
  state,
  startsAt: "2026-09-01T00:00:00.000Z",
  expiresAt: "2026-09-15T00:00:00.000Z",
  retentionUntil: "2026-10-15T00:00:00.000Z",
  remainingAI,
  usedAI: 50 - remainingAI,
  milestones: [1, 2, 3, 7, 12, 14].map(day => ({ day, reached: day < 7 })),
});

const subscription = {
  plan: "free", amountUsd: null, status: "inactive", active: false,
  planStartedAt: null, planExpiresAt: null, cancelAtPeriodEnd: false,
  addonWebinars: 0, maxWebinars: 0, webinarCount: 0, publishedCount: 0,
  isActive: false, isExpired: false, isSuperAdmin: false, hasStripeCustomer: false,
};

test.describe("No-card trial local mocked behavior", () => {
  test("an eligible account activates once and exposes a live countdown, shared AI budget, quota, and honest locks", async ({ page }) => {
    let active = false;
    let activation: Request | undefined;
    await page.route("**/api/**", route => route.fulfill({ json: [] }));
    await page.route("**/api/webinars/stats/summary", route => route.fulfill({ json: {} }));
    await page.route("**/api/webinars", route => route.fulfill({ json: [] }));
    await page.route("**/api/admin/subscription", route => route.fulfill({ json: subscription }));
    await page.route("**/api/stripe/config", route => route.fulfill({ json: { billingAvailable: true, catalogReady: true, plans: [], addonAmountUsd: 20, annualAddonAmountUsd: 204 } }));
    await page.route("**/api/ai-points", route => route.fulfill({ json: { points: 0, giftedPoints: 0, permanentPoints: 0, nextExpiry: null, nextExpiryPoints: 0, planMonthlyGift: 0, unlimited: false, packages: [] } }));
    await page.route("**/api/trial/activate", async route => {
      activation = route.request();
      active = true;
      return route.fulfill({ status: 201, json: trial("active", 50) });
    });
    await page.route("**/api/trial", async route => {
      return route.fulfill({ json: active ? trial("active", 50) : trial("eligible") });
    });

    await page.goto("/admin/dashboard");
    await page.getByTestId("button-activate-no-card-trial").click();
    expect(activation?.postDataJSON()).toEqual({});
    await expect(page.getByTestId("text-trial-countdown")).toContainText("天");
    await page.screenshot({ path: "/tmp/no-card-trial-dashboard.png", fullPage: true });
    await expect(page.getByTestId("text-trial-ai-remaining")).toHaveText("50 / 50 次");
    await expect(page.getByTestId("text-trial-page-quota")).toHaveText("剩餘 1 / 1 個");
    await expect(page.getByText("進階分析", { exact: true })).toBeVisible();
    await expect(page.getByText("自訂網域、移除品牌與團隊", { exact: true })).toBeVisible();
  });

  test("a trial sales page tracks a real view, captures consented leads, never starts checkout, and fits mobile and desktop", async ({ page }) => {
    const publicPage = {
      id: "trial-page-1", webinarId: null, offerId: "trial-product-1", slug: "my-trial-product",
      platformUrl: "/sales/my-trial-product", title: "試用商品頁",
      blocks: [{ id: "hero", enabled: true, type: "hero", headline: "整理你的下一步", subheadline: "留下資料取得資訊", ctaLabel: "取得資訊" }],
      checkoutSettings: { transitionTitle: "", transitionMessage: "", cancelTitle: "", cancelMessage: "" },
      offer: { paymentProvider: "lead_capture", checkoutMode: "lead_capture", name: "試用商品", amountMinor: 120000, currency: "TWD" },
      brand: { name: "SellCase", localizedName: "開賣啦", poweredBy: "Powered by SellCase 開賣啦" },
      leadCapture: { enabled: true, requiredFields: ["name", "email", "consent"], consentRequired: true, endpoint: "/api/trial-commerce/sales-pages/my-trial-product/leads" },
    };
    const views: Request[] = [];
    const leads: Request[] = [];
    const checkouts: Request[] = [];
    await page.route("**/api/sales-pages/my-trial-product", route => route.fulfill({ json: publicPage }));
    await page.route("**/api/trial-commerce/sales-pages/my-trial-product/events", route => { views.push(route.request()); return route.fulfill({ status: 202, json: { accepted: true, deduplicated: false } }); });
    await page.route("**/api/trial-commerce/sales-pages/my-trial-product/leads", route => { leads.push(route.request()); return route.fulfill({ status: 201, json: { accepted: true, deduplicated: false } }); });
    await page.route("**/api/products/trial-product-1/checkout", route => { checkouts.push(route.request()); return route.fulfill({ status: 500, json: { message: "must not be called" } }); });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/sales/my-trial-product");
    await expect.poll(() => views.length).toBe(1);
    expect(views[0].postDataJSON()).toMatchObject({ visitorToken: expect.any(String), dedupeKey: expect.stringMatching(/^view:trial-page-1:/) });
    const consentDialog = page.getByRole("dialog", { name: "Cookie 與行銷追蹤設定" });
    if (await consentDialog.isVisible()) await consentDialog.getByRole("button", { name: "僅使用必要功能" }).click();
    await page.getByRole("button", { name: "取得資訊" }).click();
    await page.getByLabel("姓名").fill("王小明");
    await page.getByLabel("Email").fill("lead@example.com");
    await page.getByLabel("我同意主辦人依本頁目的聯絡我。").check();
    await page.getByRole("button", { name: "送出資料" }).click();
    await expect(page.getByTestId("trial-lead-success")).toBeVisible();
    expect(leads[0].postDataJSON()).toEqual({ name: "王小明", email: "lead@example.com", consent: true });
    expect(checkouts).toHaveLength(0);
    await expect(page.getByText("Powered by SellCase 開賣啦", { exact: true })).toBeVisible();
    await page.screenshot({ path: "/tmp/no-card-trial-public-mobile.png", fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(page.getByText("Powered by SellCase 開賣啦", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  test("owner sees actual stats and retained leads, while an expired public URL remains a friendly no-PII pause and upgrade is actionable", async ({ page }) => {
    await page.route("**/api/products", route => route.fulfill({ json: [] }));
    await page.route("**/api/product-sales-pages", route => route.fulfill({ json: [] }));
    await page.route("**/api/trial", route => route.fulfill({ json: trial("expired", 0) }));
    await page.route("**/api/trial-commerce/stats", route => route.fulfill({ json: { visitors: 24, leads: 6, conversion: 25 } }));
    await page.route("**/api/trial-commerce/leads**", route => route.fulfill({ json: { page: 1, pageSize: 25, total: 1, items: [{ id: "lead-1", name: "保留名單", email: "retained@example.com", consentedAt: "2026-09-10T00:00:00.000Z", createdAt: "2026-09-10T00:00:00.000Z" }] } }));
    await page.goto("/admin/products");
    await expect(page.getByTestId("text-trial-visitors")).toHaveText("24");
    await expect(page.getByTestId("text-trial-leads")).toHaveText("6");
    await expect(page.getByTestId("text-trial-conversion")).toHaveText("25%");
    await expect(page.getByText("retained@example.com")).toBeVisible();

    await page.route("**/api/sales-pages/expired-trial", route => route.fulfill({ status: 404, json: { message: "Sales page not found" } }));
    await page.goto("/sales/expired-trial");
    await expect(page.getByText("此商品頁目前暫停")).toBeVisible();
    await expect(page.getByText("此頁不會顯示或揭露任何聯絡資料。")).toBeVisible();

    await page.route("**/api/**", route => route.fulfill({ json: [] }));
    await page.route("**/api/webinars/stats/summary", route => route.fulfill({ json: {} }));
    await page.route("**/api/webinars", route => route.fulfill({ json: [] }));
    await page.route("**/api/admin/subscription", route => route.fulfill({ json: subscription }));
    await page.route("**/api/stripe/config", route => route.fulfill({ json: { billingAvailable: true, catalogReady: true, plans: [], addonAmountUsd: 20, annualAddonAmountUsd: 204 } }));
    await page.route("**/api/ai-points", route => route.fulfill({ json: { points: 0, giftedPoints: 0, permanentPoints: 0, nextExpiry: null, nextExpiryPoints: 0, planMonthlyGift: 0, unlimited: false, packages: [] } }));
    await page.route("**/api/trial", route => route.fulfill({ json: trial("expired", 0) }));
    await page.route("**/api/stripe/config", route => route.fulfill({ json: { billingAvailable: true, catalogReady: true, plans: [{ key: "starter", amountUsd: 39, annualAmountUsd: 397.8, includedWebinars: 1, monthlyRegistrants: 1000, monthlyAiPoints: 100, trialDays: 0, available: true, annualAvailable: true }], addonAmountUsd: 20, annualAddonAmountUsd: 204 } }));
    await page.goto("/admin/dashboard");
    await page.getByTestId("button-restore-trial-page").click();
    await expect(page.getByRole("dialog")).toContainText("付款完成後立即啟用付費方案");
  });

  test("an exhausted 50-call trial is not mistaken for the paid 30-point AI budget", async ({ page }) => {
    await page.route("**/api/**", route => route.fulfill({ json: [] }));
    await page.route("**/api/webinars/stats/summary", route => route.fulfill({ json: {} }));
    await page.route("**/api/webinars", route => route.fulfill({ json: [] }));
    await page.route("**/api/admin/subscription", route => route.fulfill({ json: subscription }));
    await page.route("**/api/stripe/config", route => route.fulfill({ json: { billingAvailable: true, catalogReady: true, plans: [], addonAmountUsd: 20, annualAddonAmountUsd: 204 } }));
    await page.route("**/api/trial", route => route.fulfill({ json: trial("active", 0) }));
    await page.route("**/api/ai-points", route => route.fulfill({ json: { points: 100, giftedPoints: 100, permanentPoints: 0, nextExpiry: null, nextExpiryPoints: 0, planMonthlyGift: 0, unlimited: false, packages: [] } }));
    await page.goto("/admin/dashboard");
    await page.getByTestId("button-ai-webinar-wizard").click();
    await page.getByTestId("input-ai-wizard-title").fill("試用額度");
    await page.getByTestId("input-ai-wizard-audience").fill("創作者");
    await page.getByTestId("input-ai-wizard-goal").fill("取得名單");
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await page.getByTestId("input-ai-wizard-start").fill("2026-09-12T10:00");
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await expect(page.getByTestId("text-ai-wizard-trial-budget")).toContainText("剩餘 0 / 50 次");
    await expect(page.getByTestId("button-run-ai-webinar-wizard")).toBeDisabled();
    await expect(page.getByTestId("button-run-ai-webinar-wizard")).not.toContainText("30 點");
  });

  test("a paid upgrade is not shown as an active trial and uses the normal paid AI budget", async ({ page }) => {
    await page.route("**/api/**", route => route.fulfill({ json: [] }));
    await page.route("**/api/webinars/stats/summary", route => route.fulfill({ json: {} }));
    await page.route("**/api/webinars", route => route.fulfill({ json: [] }));
    await page.route("**/api/admin/subscription", route => route.fulfill({ json: { ...subscription, plan: "starter", status: "active", active: true, isActive: true } }));
    await page.route("**/api/stripe/config", route => route.fulfill({ json: { billingAvailable: true, catalogReady: true, plans: [], addonAmountUsd: 20, annualAddonAmountUsd: 204 } }));
    await page.route("**/api/trial", route => route.fulfill({ json: trial("upgraded", 47) }));
    await page.route("**/api/ai-points", route => route.fulfill({ json: { points: 100, giftedPoints: 100, permanentPoints: 0, nextExpiry: null, nextExpiryPoints: 0, planMonthlyGift: 100, unlimited: false, packages: [] } }));
    await page.goto("/admin/dashboard");
    await expect(page.getByTestId("text-trial-countdown")).toHaveCount(0);
    await page.getByTestId("button-ai-webinar-wizard").click();
    await page.getByTestId("input-ai-wizard-title").fill("付費方案");
    await page.getByTestId("input-ai-wizard-audience").fill("會員");
    await page.getByTestId("input-ai-wizard-goal").fill("成交");
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await page.getByTestId("input-ai-wizard-start").fill("2026-09-12T10:00");
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await expect(page.getByTestId("button-run-ai-webinar-wizard")).toContainText("使用 30 點建立草稿");
    await expect(page.getByTestId("text-ai-wizard-trial-budget")).toHaveCount(0);
  });

  test("owner applies one AI product-page draft, then explicitly saves and publishes it", async ({ page }) => {
    const initial = { id: "page-1", webinarId: null, offerId: "product-1", slug: "draft-product", title: "試用商品", status: "draft", version: 1, orderedBlocks: [{ id: "offer", enabled: true, type: "offer", layout: "ecommerce", buttonLabel: "取得資訊", images: [], summary: "", features: [] }], checkoutSettings: {} };
    const generated = [{ id: "hero-1", enabled: true, type: "hero", headline: "AI 草稿標題", subheadline: "實際產品說明", ctaLabel: "取得資訊" }, initial.orderedBlocks[0]];
    const calls: string[] = [];
    await page.route("**/api/product-sales-pages/page-1/ai-draft", route => { calls.push("ai"); return route.fulfill({ json: { blocks: generated } }); });
    await page.route("**/api/product-sales-pages/page-1/publish", route => { calls.push("publish"); return route.fulfill({ json: { ...initial, version: 3, status: "published", orderedBlocks: generated } }); });
    await page.route("**/api/product-sales-pages/page-1", route => {
      if (route.request().method() === "PATCH") { calls.push("save"); return route.fulfill({ json: { ...initial, version: 2, orderedBlocks: generated } }); }
      return route.fulfill({ json: initial });
    });
    await page.route("**/api/products", route => route.fulfill({ json: [{ id: "product-1", name: "試用商品", active: true, amountMinor: 10000, currency: "TWD", paymentProvider: "lead_capture" }] }));
    await page.route("**/api/trial", route => route.fulfill({ json: trial("active", 49) }));
    await page.route("**/api/ai-points", route => route.fulfill({ json: { points: 0, unlimited: false } }));
    await page.goto("/admin/products/sales/page-1");
    await expect(page.getByText("AI 草稿標題")).toHaveCount(0);
    page.once("dialog", dialog => dialog.accept());
    await page.getByTestId("button-ai-product-draft").click();
    await expect(page.getByRole("heading", { name: "AI 草稿標題" })).toBeVisible();
    await page.screenshot({ path: "/tmp/no-card-trial-ai-editor.png", fullPage: true });
    expect(calls).toEqual(["ai"]);
    await page.getByRole("button", { name: "發布頁面" }).click();
    await expect.poll(() => calls).toEqual(["ai", "save", "publish"]);
  });
});