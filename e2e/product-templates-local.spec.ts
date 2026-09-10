import { expect, test, type Page } from "@playwright/test";
import { createSalesPageSchema, updateSalesPageSchema, salesPageBlocksSchema } from "../server/salesPages";

const product = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "創作者實作課程",
  amountMinor: 128000,
  currency: "TWD",
  paymentProvider: "ecpay",
  active: true,
  webinarId: null,
};
const images = [
  { url: "https://images.example.test/course-cover.png", alt: "課程主圖" },
  { url: "https://images.example.test/course-details.png", alt: "課程內容圖" },
];
const blocks = [
  { id: "offer_main", type: "offer", enabled: true, layout: "ecommerce",
    headline: "舊商品名稱，不應蓋過商品資料", buttonLabel: "立即購買", priceLabel: "NT$1",
    images, summary: "從想法到完成，逐步建立你的創作流程。", features: ["完整教學", "實作講義"] },
  { id: "details", type: "richText", enabled: true, content: "詳細介紹\n依照自己的進度練習，完成你的作品。" },
  { id: "specs", type: "richText", enabled: true, content: "商品規格\n包含課程影片與電子講義。" },
  { id: "questions", type: "faq", enabled: true, items: [{ question: "如何觀看？", answer: "付款後依賣方提供的方式觀看。" }] },
];
const initialPage = {
  id: "template-page", offerId: product.id, webinarId: null, slug: "creator-course",
  title: "創作者課程商品頁", status: "draft", version: 1, orderedBlocks: blocks,
};

async function mockImages(page: Page) {
  await page.route("https://images.example.test/**", route => route.fulfill({
    contentType: "image/svg+xml",
    body: `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="800" height="800" fill="${route.request().url().includes("cover") ? "#dcece6" : "#ece3d5"}"/><rect x="155" y="105" width="490" height="590" rx="20" fill="#fffaf0"/><path d="M230 500L400 270L570 500" fill="none" stroke="#126158" stroke-width="26"/><text x="230" y="580" font-family="sans-serif" font-size="40" fill="#126158">CREATOR / 01</text></svg>`,
  }));
}

async function mockAdmin(page: Page) {
  let current: any = structuredClone(initialPage);
  const creates: any[] = [];
  const saves: any[] = [];
  await page.route("**/api/products", route => route.fulfill({ json: [product] }));
  await page.route(`**/api/products/${product.id}`, route => route.fulfill({ json: product }));
  await page.route("**/api/product-sales-pages", async route => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      expect(createSalesPageSchema.safeParse(body).success).toBe(true);
      creates.push(body);
      current = { ...current, title: body.title, slug: body.slug, orderedBlocks: body.blocks };
      await route.fulfill({ status: 201, json: current });
    } else await route.fulfill({ json: [] });
  });
  await page.route("**/api/product-sales-pages/template-page", async route => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON();
      expect(updateSalesPageSchema.safeParse(body).success).toBe(true);
      saves.push(body);
      current = { ...current, orderedBlocks: body.blocks, version: current.version + 1 };
    }
    await route.fulfill({ json: current });
  });
  await page.route("**/api/media", route => route.fulfill({ json: { assets: [], usage: {} } }));
  await mockImages(page);
  return { creates, saves };
}

async function mockPublic(page: Page, extraBlocks: unknown[] = []) {
  expect(salesPageBlocksSchema.safeParse([...blocks, ...extraBlocks]).success).toBe(true);
  await mockImages(page);
  await page.route("**/api/sales-pages/creator-course", route => route.fulfill({
    json: { ...initialPage, blocks: [...blocks, ...extraBlocks], offer: product },
  }));
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("sellcase.marketing-consent.v1", "denied"));
});

test("new pages default to ecommerce, and cancelling creates nothing", async ({ page }) => {
  const { creates } = await mockAdmin(page);
  await page.goto("/admin/products");
  await page.getByRole("button", { name: "建立商品頁", exact: true }).click();
  await expect(page.getByTestId("template-choice-ecommerce")).toBeVisible();
  await expect(page.getByTestId("template-choice-free")).toBeVisible();
  await page.keyboard.press("Escape");
  expect(creates).toHaveLength(0);
  await page.getByRole("button", { name: "建立商品頁", exact: true }).click();
  await page.getByTestId("template-create-submit").click();
  await expect(page).toHaveURL(/\/admin\/products\/sales\/template-page$/);
  expect(creates).toHaveLength(1);
  expect(creates[0].template).toBe("ecommerce");
  expect(creates[0].blocks[0]).toMatchObject({ type: "offer", layout: "ecommerce" });
  expect(creates[0].blocks.filter((block: any) => block.type === "offer" && block.enabled)).toHaveLength(1);
  expect(creates[0]).not.toHaveProperty("amountMinor");
});

test("public ecommerce gallery switches images and uses the real product and price", async ({ page }) => {
  await mockPublic(page);
  await page.goto("/sales/creator-course");
  await expect(page.getByRole("heading", { name: product.name, exact: true })).toBeVisible();
  await expect(page.getByTestId("product-main-image")).toHaveAttribute("src", images[0].url);
  await page.getByTestId("product-thumbnail-1").click();
  await expect(page.getByTestId("product-main-image")).toHaveAttribute("src", images[1].url);
  await expect(page.getByTestId("ecommerce-product-section")).toContainText("1,280");
  await expect(page.getByText("NT$1", { exact: true })).toHaveCount(0);
  await expect(page.getByText("舊商品名稱，不應蓋過商品資料", { exact: true })).toHaveCount(0);
  await page.getByText("如何觀看？", { exact: true }).click();
  await expect(page.getByText("付款後依賣方提供的方式觀看。")).toBeVisible();
  await page.screenshot({ path: "/tmp/product-template-desktop.png", fullPage: true });
});

test("mobile places gallery above product information without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockPublic(page);
  await page.goto("/sales/creator-course");
  const image = page.getByTestId("product-main-image");
  const name = page.getByRole("heading", { name: product.name, exact: true });
  await expect(name).toBeVisible();
  const imageBox = await image.boundingBox();
  const nameBox = await name.boundingBox();
  expect(imageBox).not.toBeNull();
  expect(nameBox!.y).toBeGreaterThan(imageBox!.y + imageBox!.height - 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: "/tmp/product-template-mobile.png", fullPage: true });
});

test("ecommerce summary, feature lines and gallery edits persist through save and reload", async ({ page }) => {
  const { saves } = await mockAdmin(page);
  await page.goto("/admin/products/sales/template-page");
  await page.getByTestId("product-summary").fill("修改後的商品簡介");
  const features = page.getByLabel("商品特點（每行一項）");
  await features.fill("完整教學\n實作講義");
  await features.press("End");
  await features.press("Enter");
  await features.pressSequentially("第三項重點");
  await expect(features).toHaveValue("完整教學\n實作講義\n第三項重點");
  await page.getByTestId("gallery-alt-1").fill("第二張圖片說明");
  await page.getByTestId("gallery-up-1").click();
  await page.getByRole("button", { name: "儲存草稿", exact: true }).click();
  await expect(page.getByText("所有變更已儲存")).toBeVisible();
  expect(saves[0].blocks[0]).toMatchObject({
    summary: "修改後的商品簡介",
    features: ["完整教學", "實作講義", "第三項重點"],
    images: [{ ...images[1], alt: "第二張圖片說明" }, images[0]],
  });
  await page.reload();
  await expect(page.getByTestId("product-summary")).toHaveValue("修改後的商品簡介");
  await expect(page.getByTestId("gallery-url-0")).toHaveValue(images[1].url);
  await page.getByTestId("gallery-remove-0").click();
  await page.getByRole("button", { name: "儲存草稿", exact: true }).click();
  await expect(page.getByText("所有變更已儲存")).toBeVisible();
  expect(saves[1].blocks[0].images).toEqual([images[0]]);
});

test("ecommerce purchase keeps the original checkout path and handles failure", async ({ page }) => {
  let requestBody: any;
  await mockPublic(page);
  await page.route(`**/api/products/${product.id}/checkout`, async route => {
    requestBody = route.request().postDataJSON();
    await route.fulfill({ status: 503, json: { message: "付款服務暫時忙碌" } });
  });
  await page.goto("/sales/creator-course");
  await page.getByRole("button", { name: "立即購買", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("付款服務暫時忙碌");
  expect(requestBody.salesPageId).toBe(initialPage.id);
  expect(requestBody).not.toHaveProperty("amountMinor");
});

test("video and customer feedback blocks render alongside editable details", async ({ page }) => {
  await mockPublic(page, [
    { id: "video", enabled: true, type: "video", title: "課程影片介紹", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
    { id: "feedback", enabled: true, type: "testimonials", headline: "學員回饋", items: [{ name: "測試學員", quote: "這是測試用的真實回饋欄位內容。", role: "創作者" }] },
  ]);
  await page.route("https://www.youtube-nocookie.com/**", route => route.fulfill({ contentType: "text/html", body: "<html><body>Video fixture</body></html>" }));
  await page.goto("/sales/creator-course");
  await expect(page.locator('iframe[src*="youtube-nocookie.com/embed/dQw4w9WgXcQ"]')).toHaveCount(1);
  await expect(page.locator("blockquote footer")).toHaveText("測試學員 · 創作者");
  await expect(page.locator("blockquote")).toContainText("這是測試用的真實回饋欄位內容。");
});