import { expect, test, type Page, type Request } from "@playwright/test";
import { updateSalesPageSchema } from "../server/salesPages";

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

const hero = {
  id: "hero-main",
  enabled: true,
  type: "hero",
  headline: "不用直播也能購買",
  subheadline: "這是一個獨立商品頁。",
  ctaLabel: "立即購買",
};

const checkoutSettings = {
  transitionTitle: "正在建立安全付款",
  transitionMessage: "請稍候，不要關閉視窗。",
  successTitle: "付款成功",
  successMessage: "謝謝你的購買。",
  successButtonLabel: "查看內容",
  successButtonUrl: "",
  cancelTitle: "付款未完成",
  cancelMessage: "可以回到商品頁重試。",
};

const product = {
  id: "product-local-1",
  name: "零直播獨立商品",
  amountMinor: 88000,
  currency: "TWD",
  paymentProvider: "ecpay",
  active: true,
  webinarId: null,
};

const salesPage = {
  id: "page-local-1",
  webinarId: null,
  offerId: product.id,
  slug: "zero-webinar-product",
  title: "零直播商品頁",
  status: "draft" as const,
  version: 1,
  orderedBlocks: [hero],
  checkoutSettings,
};

async function dismissCookieConsent(page: Page) {
  const consent = page.getByRole("dialog", { name: "Cookie 與行銷追蹤設定" });
  if (await consent.isVisible()) {
    await consent.getByRole("button", { name: "僅使用必要功能" }).click();
  }
}

test.describe("Standalone products local mocked behavior", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/products", route => route.fulfill({ json: [product] }));
  });

  test("creates a zero-webinar product and its sales page with the documented payloads", async ({ page }) => {
    const products: typeof product[] = [];
    const pages: Array<typeof salesPage> = [];
    let productPost: Request | undefined;
    let pagePost: Request | undefined;

    await page.route("**/api/products", async route => {
      const request = route.request();
      if (request.method() === "POST") {
        productPost = request;
        products.push(product);
        await route.fulfill({ status: 201, json: product });
      } else {
        await route.fulfill({ json: products });
      }
    });
    await page.route("**/api/product-sales-pages", async route => {
      const request = route.request();
      if (request.method() === "POST") {
        pagePost = request;
        pages.push(salesPage);
        await route.fulfill({ status: 201, json: salesPage });
      } else {
        await route.fulfill({ json: pages });
      }
    });
    await page.route("**/api/product-sales-pages/page-local-1", route =>
      route.fulfill({ json: salesPage }),
    );

    await page.goto("/admin/products");
    await page.getByRole("button", { name: "建立商品", exact: true }).first().click();
    const dialog = page.getByRole("dialog", { name: "建立商品" });
    await dialog.getByText("商品名稱", { exact: true }).locator("..").getByRole("textbox").fill(product.name);
    await dialog.getByRole("spinbutton").fill("880");
    await dialog.getByRole("button", { name: "儲存" }).click();

    await expect(page.getByRole("heading", { name: product.name })).toBeVisible();
    expect(productPost?.postDataJSON()).toEqual({ name: product.name, amountTwd: 880 });
    expect(productPost?.postDataJSON()).not.toHaveProperty("webinarId");

    await page.getByRole("button", { name: "建立商品頁" }).click();
    await page.getByTestId("template-choice-free").click();
    await page.getByTestId("template-create-submit").click();
    await expect(page).toHaveURL(/\/admin\/products\/sales\/page-local-1$/);
    expect(pagePost?.postDataJSON()).toMatchObject({
      offerId: product.id,
      title: `${product.name} 商品頁`,
    });
    expect(pagePost?.postDataJSON()).not.toHaveProperty("webinarId");
    expect(pagePost?.postDataJSON().blocks.map((block: { type: string }) => block.type))
      .toEqual(["hero", "benefits", "offer", "faq"]);
  });

  test("uploads a PNG preview, saves the draft, publishes, and unpublishes with versions", async ({ page }) => {
    let current: any = { ...salesPage, orderedBlocks: [{ ...hero }] };
    const patches: unknown[] = [];
    const actions: Array<{ action: string; body: unknown }> = [];
    let failNextSave = false;

    await page.route("**/api/product-sales-pages/page-local-1", async route => {
      const request = route.request();
      if (request.method() === "GET") return route.fulfill({ json: current });
      if (failNextSave) {
        failNextSave = false;
        return route.fulfill({ status: 500, json: { message: "後端拒絕儲存" } });
      }
      const body = request.postDataJSON();
      expect(updateSalesPageSchema.safeParse(body).success).toBe(true);
      patches.push(body);
      current = { ...current, ...body, orderedBlocks: body.blocks, version: current.version + 1 };
      return route.fulfill({ json: current });
    });
    await page.route(/\/api\/product-sales-pages\/page-local-1\/(publish|unpublish)$/, async route => {
      const action = route.request().url().endsWith("/publish") ? "publish" : "unpublish";
      actions.push({ action, body: route.request().postDataJSON() });
      current = {
        ...current,
        status: action === "publish" ? "published" : "draft",
        version: current.version + 1,
      };
      await route.fulfill({ json: current });
    });
    await page.route("**/api/upload", async route => {
      expect(route.request().method()).toBe("POST");
      expect(route.request().headers()["content-type"]).toContain("multipart/form-data");
      await route.fulfill({ status: 201, json: { url: "/uploads/tiny-product-banner.png" } });
    });
    await page.route("**/uploads/tiny-product-banner.png", route =>
      route.fulfill({ contentType: "image/png", body: tinyPng }),
    );

    await page.goto("/admin/products/sales/page-local-1");
    await expect(page.getByText("頁面結構", { exact: true })).toBeVisible();
    await page.locator('input[type="file"]').setInputFiles({
      name: "banner.png",
      mimeType: "image/png",
      buffer: tinyPng,
    });
    await expect(page.locator('.studio-preview-hero img[src="/uploads/tiny-product-banner.png"]')).toBeVisible();
    await page.getByLabel("頁面名稱").fill("已更新的零直播商品頁");
    await page.getByRole("button", { name: "儲存草稿", exact: true }).click();
    await expect(page.getByText("所有變更已儲存")).toBeVisible();

    const draft = patches[0] as Record<string, any>;
    expect(draft).toMatchObject({ version: 1, title: "已更新的零直播商品頁", slug: salesPage.slug });
    expect(draft.blocks[0].imageUrl).toBe("/uploads/tiny-product-banner.png");
    expect(draft.checkoutSettings).toEqual(checkoutSettings);

    await page.getByRole("button", { name: "發布頁面" }).click();
    await expect(page.getByRole("button", { name: "取消發布" })).toBeVisible();
    expect(patches[1]).toMatchObject({ version: 2 });
    expect(actions[0]).toEqual({ action: "publish", body: { version: 3 } });

    await page.getByRole("button", { name: "取消發布" }).click();
    await expect(page.getByRole("button", { name: "發布頁面" })).toBeVisible();
    expect(actions[1]).toEqual({ action: "unpublish", body: { version: 4 } });

    failNextSave = true;
    await page.getByLabel("頁面名稱").fill("不會被默默吞掉的失敗");
    await page.getByRole("button", { name: "儲存草稿", exact: true }).click();
    await expect(page.getByText(/後端拒絕儲存/)).toBeVisible();
  });

  test("a published page keeps draft saves private and update-publish commits the new version", async ({ page }) => {
    let current: any = {
      ...salesPage,
      status: "published",
      version: 7,
      orderedBlocks: [{ ...hero, headline: "目前公開內容" }],
      publishedOrderedBlocks: [{ ...hero, headline: "目前公開內容" }],
      publishedCheckoutSettings: checkoutSettings,
    };
    const requests: Array<{ method: string; url: string; body: any }> = [];

    await page.route("**/api/product-sales-pages/page-local-1", async route => {
      const request = route.request();
      if (request.method() === "GET") return route.fulfill({ json: current });
      const body = request.postDataJSON();
      expect(updateSalesPageSchema.safeParse(body).success).toBe(true);
      requests.push({ method: request.method(), url: request.url(), body });
      current = { ...current, ...body, orderedBlocks: body.blocks, version: current.version + 1 };
      return route.fulfill({ json: current });
    });
    await page.route("**/api/product-sales-pages/page-local-1/publish", async route => {
      const request = route.request();
      requests.push({ method: request.method(), url: request.url(), body: request.postDataJSON() });
      current = {
        ...current, status: "published", version: current.version + 1,
        publishedOrderedBlocks: structuredClone(current.orderedBlocks),
        publishedCheckoutSettings: structuredClone(current.checkoutSettings),
      };
      await route.fulfill({ json: current });
    });

    await page.goto("/admin/products/sales/page-local-1");
    await expect(page.getByLabel("頁面名稱")).toBeDisabled();
    await expect(page.getByLabel("頁面名稱")).toHaveAttribute(
      "title",
      "已發布頁面須先取消發布，才能修改名稱與網址。",
    );
    const headlineInput = page.getByLabel("主標題", { exact: true });

    await headlineInput.fill("只存在草稿的內容");
    await page.getByRole("button", { name: "儲存草稿", exact: true }).click();
    await expect(page.getByText("所有變更已儲存")).toBeVisible();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      method: "PATCH",
      body: {
        version: 7,
        title: salesPage.title,
        slug: salesPage.slug,
      },
    });
    expect(requests[0].body.blocks[0].headline).toBe("只存在草稿的內容");
    expect(requests.some(request => request.url.endsWith("/publish"))).toBe(false);

    await headlineInput.fill("下一個正式公開內容");
    await page.getByRole("button", { name: "更新發布", exact: true }).click();
    await expect(page.getByText("公開版本", { exact: true })).toBeVisible();
    expect(requests).toHaveLength(3);
    expect(requests[1]).toMatchObject({
      method: "PATCH",
      body: {
        version: 8,
        title: salesPage.title,
        slug: salesPage.slug,
      },
    });
    expect(requests[1].body.blocks[0].headline).toBe("下一個正式公開內容");
    expect(requests[2]).toMatchObject({
      method: "POST",
      body: { version: 9 },
    });
    expect(requests[2].url).toMatch(/\/api\/product-sales-pages\/page-local-1\/publish$/);
  });

  test("shows orders and archives then restores a product", async ({ page }) => {
    let active = true;
    const state = () => [{ ...product, active, salesPage: { ...salesPage, status: "published" as const } }];
    const mutations: Array<{ method: string; body: unknown }> = [];

    await page.route("**/api/products", route => route.fulfill({ json: state() }));
    await page.route("**/api/product-sales-pages", route =>
      route.fulfill({ json: [{ ...salesPage, status: "published" }] }),
    );
    await page.route("**/api/products/product-local-1/orders", route => route.fulfill({
      json: [
        { id: "order-direct", amountMinor: 88000, currency: "TWD", status: "paid", createdAt: "2026-09-10T01:00:00.000Z", source: "direct", webinarId: null },
        { id: "order-webinar", amountMinor: 88000, currency: "TWD", status: "refunded", createdAt: "2026-09-09T01:00:00.000Z", source: "webinar", webinarId: "webinar-1" },
      ],
    }));
    await page.route("**/api/products/product-local-1", async route => {
      const request = route.request();
      mutations.push({ method: request.method(), body: request.postDataJSON() });
      active = request.method() === "PATCH";
      await route.fulfill({ json: { ...product, active } });
    });

    await page.goto("/admin/products");
    await page.getByRole("button", { name: "訂單" }).click();
    const orders = page.getByRole("dialog", { name: `${product.name}・訂單` });
    await expect(orders.getByText("獨立商品頁")).toBeVisible();
    await expect(orders.getByText("直播", { exact: true })).toBeVisible();
    await expect(orders.getByText("paid", { exact: true })).toBeVisible();
    await expect(orders.getByText("refunded", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "封存" }).click();
    await expect(page.getByText("已封存", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "恢復" }).click();
    await expect(page.getByText("販售中", { exact: true })).toBeVisible();
    expect(mutations).toEqual([
      { method: "DELETE", body: null },
      { method: "PATCH", body: { active: true } },
    ]);
  });

  test("keeps the product listing and sales editor controls visible without 390px overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route("**/api/products", route =>
      route.fulfill({ json: [{ ...product, salesPage }] }),
    );
    await page.route("**/api/product-sales-pages", route =>
      route.fulfill({ json: [salesPage] }),
    );
    await page.route("**/api/product-sales-pages/page-local-1", route =>
      route.fulfill({ json: salesPage }),
    );

    await page.goto("/admin/products");
    await expect(page.getByRole("heading", { name: "商品與獨立銷售頁" })).toBeVisible();
    await expect(page.getByRole("button", { name: "建立商品", exact: true }).first()).toBeInViewport();
    expect(await page.evaluate(() => ({
      document: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      body: document.body.scrollWidth <= document.body.clientWidth,
    }))).toEqual({ document: true, body: true });
    await page.screenshot({ path: "/tmp/products-admin-mobile.png", fullPage: true });

    await page.goto("/admin/products/sales/page-local-1");
    await expect(page.getByText("頁面結構", { exact: true })).toBeVisible();
    const save = page.getByRole("button", { name: "儲存草稿", exact: true });
    const publish = page.getByRole("button", { name: "發布頁面", exact: true });
    await expect(save).toBeVisible();
    await expect(save).toBeInViewport();
    await expect(publish).toBeVisible();
    await expect(publish).toBeInViewport();
    expect(await page.evaluate(() => ({
      document: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      body: document.body.scrollWidth <= document.body.clientWidth,
    }))).toEqual({ document: true, body: true });
    await page.screenshot({ path: "/tmp/products-editor-mobile.png", fullPage: true });

    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(save).toBeVisible();
    await expect(publish).toBeVisible();
    await page.screenshot({ path: "/tmp/products-editor-desktop.png", fullPage: true });
  });

  test("public product page fits 390px, does not fake checkout analytics, and exposes checkout failure", async ({ page }) => {
    const publicPage = {
      ...salesPage,
      status: "published",
      blocks: [
        hero,
        { id: "offer", enabled: true, type: "offer", headline: "完整方案", buttonLabel: "取得商品" },
      ],
      offer: { name: product.name, amountMinor: product.amountMinor, currency: "TWD", paymentProvider: "ecpay" },
    };
    const funnelRequests: Request[] = [];
    const checkoutRequests: Request[] = [];
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route("**/api/sales-pages/zero-webinar-product", route => route.fulfill({ json: publicPage }));
    await page.route("**/api/webinars/**/funnel-events", route => {
      funnelRequests.push(route.request());
      return route.fulfill({ status: 204 });
    });
    await page.route("**/api/products/product-local-1/checkout", route => {
      checkoutRequests.push(route.request());
      return route.fulfill({ status: 503, json: { message: "金流目前無法連線" } });
    });

    await page.goto("/sales/zero-webinar-product");
    await dismissCookieConsent(page);
    await expect(page.getByRole("heading", { name: hero.headline })).toBeVisible();
    expect(checkoutRequests).toHaveLength(0);
    expect(funnelRequests).toHaveLength(0);
    expect(await page.evaluate(() => ({
      document: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      body: document.body.scrollWidth <= document.body.clientWidth,
    }))).toEqual({ document: true, body: true });

    await page.getByRole("button", { name: hero.ctaLabel }).click();
    await expect(page.getByRole("alert")).toContainText("金流目前無法連線");
    expect(checkoutRequests).toHaveLength(1);
    const body = checkoutRequests[0].postDataJSON();
    expect(body.salesPageId).toBe(salesPage.id);
    expect(body.visitorToken).toEqual(expect.any(String));
    expect(body).not.toHaveProperty("webinarId");
    expect(body).not.toHaveProperty("offerId");
    expect(funnelRequests).toHaveLength(0);
  });

  test("a historical webinar-linked product page still requires consent and uses direct product checkout", async ({ page }) => {
    const historicalPage = {
      ...salesPage,
      webinarId: "historical-webinar",
      status: "published",
      blocks: [hero],
      offer: { name: product.name, amountMinor: product.amountMinor, currency: "TWD", paymentProvider: "ecpay" },
    };
    const productEvents: Request[] = [];
    const productCheckouts: Request[] = [];
    const oldWebinarCheckouts: Request[] = [];
    await page.route("**/api/sales-pages/zero-webinar-product", route =>
      route.fulfill({ json: historicalPage }),
    );
    await page.route("**/api/products/product-local-1/events", route => {
      productEvents.push(route.request());
      return route.fulfill({ status: 204 });
    });
    await page.route("**/api/products/product-local-1/checkout", route => {
      productCheckouts.push(route.request());
      return route.fulfill({ status: 503, json: { message: "歷史頁付款暫停" } });
    });
    await page.route("**/api/webinars/historical-webinar/offer-checkout", route => {
      oldWebinarCheckouts.push(route.request());
      return route.fulfill({ status: 500, json: { message: "不應呼叫舊結帳路由" } });
    });

    await page.goto("/sales/zero-webinar-product");
    const consent = page.getByRole("dialog", { name: "Cookie 與行銷追蹤設定" });
    await expect(consent).toBeVisible();
    expect(productEvents).toHaveLength(0);
    await consent.getByRole("button", { name: "同意行銷追蹤" }).click();
    await expect.poll(() => productEvents.length).toBe(1);
    expect(productEvents[0].postDataJSON()).toMatchObject({
      eventType: "landing_view",
      pageId: salesPage.id,
      visitorToken: expect.any(String),
      dedupeKey: expect.stringMatching(/^landing:page-local-1:/),
    });

    await page.getByRole("button", { name: hero.ctaLabel }).click();
    await expect(page.getByRole("alert")).toContainText("歷史頁付款暫停");
    expect(productCheckouts).toHaveLength(1);
    expect(productCheckouts[0].postDataJSON()).toMatchObject({
      salesPageId: salesPage.id,
      visitorToken: expect.any(String),
    });
    expect(oldWebinarCheckouts).toHaveLength(0);
  });

  test("admin control sends live standalone-page and direct-product destinations over WebSocket", async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__productWsMessages = [];
      class MockWebSocket {
        static OPEN = 1;
        readyState = 1;
        onopen: ((event: Event) => void) | null = null;
        onmessage: ((event: MessageEvent) => void) | null = null;
        onclose: ((event: CloseEvent) => void) | null = null;
        constructor(_url: string) {
          setTimeout(() => this.onopen?.(new Event("open")), 0);
        }
        send(data: string) {
          (window as any).__productWsMessages.push(JSON.parse(data));
        }
        close() {
          this.readyState = 3;
        }
      }
      (window as any).WebSocket = MockWebSocket;
    });
    const webinar = {
      id: "control-webinar",
      title: "Live product controls",
      description: "Mocked live control",
      publishStatus: "published",
      startTime: "2026-09-11T01:00:00.000Z",
      timezone: "Asia/Taipei",
      vimeoUrl: "",
    };
    await page.route("**/api/webinars/control-webinar", route => route.fulfill({ json: webinar }));
    await page.route("**/api/webinars/control-webinar/polls", route => route.fulfill({ json: [] }));
    await page.route("**/api/webinars/control-webinar/fake-users", route => route.fulfill({ json: [] }));
    await page.route("**/api/products", route => route.fulfill({ json: [product] }));
    await page.route("**/api/product-sales-pages", route =>
      route.fulfill({ json: [{ ...salesPage, status: "published" }] }),
    );

    await page.goto("/admin/webinar/control-webinar/control");
    await expect(page.getByTestId("input-studio-cta-text")).toBeVisible();
    await expect.poll(async () => page.evaluate(() =>
      (window as any).__productWsMessages.some((message: any) => message.type === "joinAsHost"),
    )).toBe(true);
    const panel = page.getByTestId("input-studio-cta-text").locator("xpath=..");
    const selects = panel.locator("select");

    await page.getByTestId("input-studio-cta-text").fill("現在看商品頁");
    await selects.nth(0).selectOption("page");
    await expect(selects.nth(1).getByRole("option", { name: salesPage.title })).toBeAttached();
    await selects.nth(1).selectOption(salesPage.id);
    await page.getByTestId("input-studio-cta-dur").fill("45");
    await page.getByTestId("button-studio-push-cta").click();

    await selects.nth(0).selectOption("offer");
    await expect(selects.nth(1).getByRole("option", { name: product.name })).toBeAttached();
    await selects.nth(1).selectOption(product.id);
    await page.getByTestId("input-studio-cta-text").fill("直接購買商品");
    await page.getByTestId("button-studio-push-cta").click();

    const liveMessages = await page.evaluate(() =>
      (window as any).__productWsMessages.filter((message: any) => message.type === "liveCta"),
    );
    expect(liveMessages).toEqual([
      {
        type: "liveCta",
        data: {
          text: "現在看商品頁",
          url: null,
          offerId: null,
          salesPageId: salesPage.id,
          style: "primary",
          durationSec: 45,
        },
      },
      {
        type: "liveCta",
        data: {
          text: "直接購買商品",
          url: null,
          offerId: product.id,
          salesPageId: null,
          style: "primary",
          durationSec: 45,
        },
      },
    ]);
  });

  test("scheduled CTA selects a published standalone page and sends its typed destination", async ({ page }) => {
    let ctaRequest: Request | undefined;
    const webinar = {
      id: "cta-webinar",
      title: "CTA regression webinar",
      description: "Regression fixture",
      publishStatus: "draft",
      startTime: "2026-09-11T01:00:00.000Z",
      timezone: "Asia/Taipei",
      customFields: [],
      scheduleMode: "fixed",
      scarcitySettings: {},
    };
    // Register the catch-all first: Playwright gives later, more specific routes priority.
    await page.route("**/api/**", route => {
      const url = new URL(route.request().url());
      if (url.pathname.includes("analytics")) return route.fulfill({ json: {} });
      if (url.pathname.includes("lead-insights")) return route.fulfill({ json: { leads: [], total: 0 } });
      return route.fulfill({ json: [] });
    });
    await page.route("**/api/products", route => route.fulfill({ json: [product] }));
    await page.route("**/api/product-sales-pages", route =>
      route.fulfill({ json: [{ ...salesPage, status: "published" }] }),
    );
    await page.route("**/api/webinars/cta-webinar/ctas", async route => {
      if (route.request().method() === "POST") {
        ctaRequest = route.request();
        return route.fulfill({ status: 201, json: { id: "cta-created", ...route.request().postDataJSON() } });
      }
      return route.fulfill({ json: [] });
    });
    await page.route("**/api/webinars/cta-webinar", route => route.fulfill({ json: webinar }));
    await page.route("**/api/ai-points", route => route.fulfill({ json: { points: 0, unlimited: false } }));

    await page.goto("/admin/webinar/cta-webinar");
    await page.getByTestId("tab-interactions").click();
    await page.getByTestId("button-add-cta").click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/按鈕文字/).fill("前往獨立商品頁");
    await dialog.getByTestId("select-cta-offer").click();
    await expect(page.getByRole("option", { name: `直接購買：${product.name}` })).toBeVisible();
    await page.getByRole("option", { name: `站內商品頁：${salesPage.title}` }).click();
    await dialog.getByLabel(/開始時間/).fill("1:05");
    await dialog.getByLabel(/結束時間/).fill("2:10");
    await dialog.getByRole("button", { name: /建立|新增/ }).last().click();

    await expect.poll(() => ctaRequest?.postDataJSON()).toEqual({
      text: "前往獨立商品頁",
      url: null,
      offerId: null,
      salesPageId: salesPage.id,
      startTime: 65,
      endTime: 130,
      style: "primary",
    });
  });
});