import { expect, test, type Page } from "@playwright/test";

const productId = "11111111-1111-4111-8111-111111111111";
const orderId = "22222222-2222-4222-8222-222222222222";
const item = {
  id: orderId, createdAt: "2025-01-10T02:00:00.000Z", purchasedAt: "2025-01-10T02:03:00.000Z",
  paymentStatus: "paid", fulfillmentStatus: "pending", version: 2,
  product: { id: productId, name: "數位課程", nameSource: "recorded" },
  buyer: { name: "王小明", email: "buyer@example.com", source: "recorded" },
  money: { amountMinor: 120000, refundedMinor: 0, netMinor: 120000, currency: "TWD" },
  receipt: { provider: "ecpay", providerReference: "SC-123", providerStatus: "paid" },
};

function detail(version = 2) {
  return {
    ...item, version, internalNote: "首筆備註",
    receipt: { ...item.receipt, providerStatusMessage: "付款完成", refundInformation: "external_merchant_status_unknown" },
    attribution: { source: "direct", webinarId: null, salesPageId: "33333333-3333-4333-8333-333333333333", originSalesPageId: null, ctaId: null, registrationId: null },
    events: [{ id: "event-1", type: "payment_paid", occurredAt: item.purchasedAt, actor: "provider", reason: null, details: { providerStatus: "paid" } }],
  };
}

async function mockOrders(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("sellcase.marketing-consent.v1", "denied");
    localStorage.setItem("icta-lang", "zh-TW");
  });
  let conflict = true;
  const state = { listRequests: 0, patches: [] as any[] };
  await page.route("**/api/member/orders**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/member/orders/product-filters") return route.fulfill({ json: { items: [{ id: productId, name: "數位課程", nameSource: "recorded" }] } });
    if (url.pathname === "/api/member/orders/summary") return route.fulfill({ json: { currencies: [{ currency: "TWD", counts: { pending: 0, paid: 1, failed: 0, partially_refunded: 0, refunded: 0 }, paidGrossMinor: 120000, refundedMinor: 0, netMinor: 120000 }] } });
    if (url.pathname === `/api/member/orders/${orderId}`) {
      if (route.request().method() === "PATCH") {
        state.patches.push(route.request().postDataJSON());
        if (conflict) { conflict = false; return route.fulfill({ status: 409, json: { code: "VERSION_CONFLICT", message: "Version conflict" } }); }
        return route.fulfill({ json: detail(3) });
      }
      return route.fulfill({ json: detail(conflict ? 2 : 3) });
    }
    state.listRequests++;
    return route.fulfill({ json: { items: [item], page: Number(url.searchParams.get("page") || 1), pageSize: 25, total: 1 } });
  });
  await page.route("**/api/member/orders/export.csv**", async route => route.fulfill({
    headers: { "Content-Type": "text/csv", "X-Export-Truncated": "false", "X-Export-Row-Count": "1" },
    body: "id\n22222222-2222-4222-8222-222222222222\n",
  }));
  return state;
}

test("member orders filters, detail, conflict reload, export and mobile layout", async ({ page }) => {
  const state = await mockOrders(page);
  await page.goto("/admin/orders");
  await expect(page.getByTestId("member-orders-page")).toBeVisible();
  await expect(page.getByTestId(`member-order-${orderId}`)).toContainText("數位課程");
  await page.screenshot({ path: "/tmp/member-orders-desktop.png", fullPage: true });
  await page.getByTestId("member-orders-search").fill("王小明");
  await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe("王小明");
  await page.getByTestId(`member-order-${orderId}`).click();
  await expect(page.getByTestId("member-order-detail")).toContainText("完整訂單編號");
  await expect(page.getByText("付款回呼來源：ECPay 經驗證回呼")).toBeVisible();
  await page.getByTestId("member-order-reason").fill("客服確認");
  await page.getByTestId("member-order-note").fill("更新後備註");
  await page.getByTestId("member-order-save").click();
  await expect(page.getByRole("alert")).toContainText("剛被其他操作更新");
  await expect(page.getByTestId("member-order-note")).toHaveValue("首筆備註");
  const listCountBeforeSave = state.listRequests;
  await page.getByTestId("member-order-reason").fill("客服確認");
  await page.getByTestId("member-order-note").fill("已完成客服核對");
  await page.getByTestId("member-order-save").click();
  await expect(page.getByText("訂單處理資訊已更新", { exact: true })).toBeVisible();
  await expect.poll(() => state.listRequests).toBeGreaterThan(listCountBeforeSave);
  // The second request follows the conflict refresh and must use the fresh version.
  expect(state.patches).toEqual([
    { expectedVersion: 2, reason: "客服確認", internalNote: "更新後備註" },
    { expectedVersion: 3, reason: "客服確認", internalNote: "已完成客服核對" },
  ]);
  await page.getByRole("button", { name: "Close" }).click();
  const download = page.waitForEvent("download");
  await page.getByTestId("member-orders-export").click();
  await (await download).cancel();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId(`member-order-${orderId}`).click();
  await expect(page.getByTestId("member-order-detail")).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "/tmp/member-orders-mobile.png", fullPage: true });
});

test("sales checkout requires buyer contact and sends exact buyer body", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("sellcase.marketing-consent.v1", "denied"));
  let checkoutBody: any;
  await page.route("**/api/sales-pages/demo", route => route.fulfill({ json: {
    id: "33333333-3333-4333-8333-333333333333", title: "Demo", webinarId: null, offerId: productId,
    blocks: [{ id: "offer", enabled: true, type: "offer", headline: "課程", buttonLabel: "立即購買" }],
    offer: { name: "數位課程", amountMinor: 120000, currency: "TWD", paymentProvider: "stripe" },
  } }));
  await page.route(`**/api/products/${productId}/checkout`, async route => {
    checkoutBody = route.request().postDataJSON();
    await route.fulfill({ json: { provider: "stripe", url: "https://payments.example.test/checkout" } });
  });
  await page.goto("/sales/demo");
  await page.getByRole("button", { name: "立即購買" }).click();
  await expect(page.getByTestId("checkout-buyer-dialog")).toBeVisible();
  await page.getByTestId("checkout-buyer-continue").click();
  await expect(page.getByTestId("checkout-buyer-error")).toContainText("姓名");
  await page.getByTestId("checkout-buyer-name").fill("王小明");
  await page.getByTestId("checkout-buyer-email").fill("buyer@example.com");
  await page.getByTestId("checkout-buyer-continue").click();
  await expect.poll(() => checkoutBody?.buyer).toEqual({ name: "王小明", email: "buyer@example.com" });
});

async function mockViewerCheckout(page: Page, registrationId?: string) {
  const webinarId = "44444444-4444-4444-8444-444444444444";
  const ctaId = "55555555-5555-4555-8555-555555555555";
  let checkoutBody: any;
  await page.addInitScript(() => localStorage.setItem("sellcase.marketing-consent.v1", "denied"));
  await page.route(`**/api/webinars/${webinarId}/offer-checkout`, async route => {
    checkoutBody = route.request().postDataJSON();
    await route.fulfill({ json: { provider: "stripe", url: "https://payments.example.test/checkout" } });
  });
  await page.route(`**/api/webinars/${webinarId}/watch-state**`, route => route.fulfill({ json: {
    canWatch: true, vimeoUrl: "https://vimeo.com/123456789", ...(registrationId ? { registrationId } : {}),
  } }));
  await page.route(`**/api/webinars/${webinarId}/ctas`, route => route.fulfill({ json: [{
    id: ctaId, webinarId, text: "立即結帳", style: "primary", offerId: productId, startTime: 0, endTime: null,
  }] }));
  await page.route(`**/api/webinars/${webinarId}/scheduled-messages`, route => route.fulfill({ json: [] }));
  await page.route(`**/api/webinars/${webinarId}/fake-users`, route => route.fulfill({ json: [] }));
  await page.route(`**/api/webinars/${webinarId}/tips`, route => route.fulfill({ json: [] }));
  await page.route(`**/api/webinars/${webinarId}/feedback-survey`, route => route.fulfill({ json: null }));
  await page.route(`**/api/webinars/${webinarId}/progress/**`, route => route.fulfill({ json: { lastPosition: 0, totalWatched: 0 } }));
  await page.route(`**/api/webinars/${webinarId}/funnel-events`, route => route.fulfill({ json: {} }));
  await page.route(`**/api/webinars/${webinarId}`, route => route.fulfill({ json: {
    id: webinarId, title: "Checkout webinar", publishStatus: "published", vimeoUrl: "https://vimeo.com/123456789",
    startTime: "2020-01-01T00:00:00.000Z", timezone: "UTC", replayEnabled: true, replayAvailableHours: 48,
  } }));
  return { webinarId, ctaId, body: () => checkoutBody };
}

test("viewer checkout sends only a bound registered identity and its issued watch token", async ({ page }) => {
  const registrationId = "66666666-6666-4666-8666-666666666666";
  const viewer = await mockViewerCheckout(page, registrationId);
  await page.goto(`/webinar/${viewer.webinarId}?watchToken=issued-watch-token`);
  await page.getByTestId("input-nickname").fill("測試觀眾");
  await page.getByTestId("button-join").click();
  await page.getByRole("button", { name: "立即結帳" }).click({ force: true });
  await expect.poll(() => viewer.body()).toMatchObject({
    registrationId,
    watchToken: "issued-watch-token",
  });
  expect(viewer.body().buyer).toBeUndefined();
});

test("unregistered viewer checkout collects buyer contact", async ({ page }) => {
  const viewer = await mockViewerCheckout(page);
  await page.goto(`/webinar/${viewer.webinarId}?watchToken=issued-watch-token`);
  await page.getByTestId("input-nickname").fill("測試觀眾");
  await page.getByTestId("button-join").click();
  await page.getByRole("button", { name: "立即結帳" }).click({ force: true });
  await page.getByTestId("checkout-buyer-name").fill("未報名買家");
  await page.getByTestId("checkout-buyer-email").fill("guest@example.com");
  await page.getByTestId("checkout-buyer-continue").click();
  await expect.poll(() => viewer.body()?.buyer).toEqual({ name: "未報名買家", email: "guest@example.com" });
  expect(viewer.body().registrationId).toBeUndefined();
});

async function mockDashboardNavigation(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("sellcase.marketing-consent.v1", "denied");
    localStorage.setItem("icta-lang", "zh-TW");
  });
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    const responses: Record<string, unknown> = {
      "/api/webinars": [], "/api/webinars/stats/summary": {},
      "/api/admin/subscription": { plan: "growth", amountUsd: 99, status: "active", active: true, planStartedAt: null, planExpiresAt: null, cancelAtPeriodEnd: false, addonWebinars: 0, maxWebinars: 5, webinarCount: 0, publishedCount: 0, isActive: true, isExpired: false, isSuperAdmin: false, hasStripeCustomer: false },
      "/api/stripe/config": { billingAvailable: false, catalogReady: false, plans: [], publishableKey: "" },
      "/api/ai-points": { points: 100, unlimited: false, giftedPoints: 100, permanentPoints: 0, packages: [] },
      "/api/admin/ecpay-connection": null, "/api/products": [], "/api/product-sales-pages": [],
      "/api/media": { assets: [], usage: { videoBytes: 0, maxVideoBytes: 0 } }, "/api/media/config": { videoEnabled: false, imageEnabled: false },
    };
    await route.fulfill({ json: responses[path] ?? {} });
  });
}

test("order management remains available in 390 and 768 mobile admin navigation", async ({ page }) => {
  await mockDashboardNavigation(page);
  for (const width of [390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/admin/dashboard");
    await page.getByTestId("button-admin-mobile-menu").click();
    await expect(page.getByTestId("mobile-button-orders")).toBeVisible();
    await page.keyboard.press("Escape");
  }
});