import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("sellcase.marketing-consent.v1", "denied");
    localStorage.setItem("icta-lang", "zh-TW");
  });
});

for (const width of [390, 768, 1280]) {
  test(`homepage layout and pricing remain readable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.locator("main h1")).toBeVisible();
    await expect(page.locator("#how")).toBeAttached();
    const pricing = page.locator("#pricing");
    for (const amount of ["$39", "$99", "$199", "$397.80", "$1,009.80", "$2,029.80"]) {
      await expect(pricing).toContainText(amount);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const headingsFit = await page.locator("main h1, main h2").evaluateAll(elements =>
      elements.every(element => {
        const bounds = element.getBoundingClientRect();
        return bounds.left >= -1 && bounds.right <= innerWidth + 1;
      }),
    );
    expect(headingsFit).toBe(true);
    await expect(page.locator('footer a[href="/legal/privacy"]')).toBeVisible();
    if (width === 390 || width === 1280) {
      await page.screenshot({ path: `/tmp/sellcase-home-${width}.png`, fullPage: true });
    }
  });
}

test("desktop feature navigation and keyboard dismissal work", async ({ page }) => {
  await page.goto("/");
  const trigger = page.locator(".sc-navlinks").getByRole("button", { name: "功能", exact: true });
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator('.sc-mega a[href="/features/ai-assistant"]')).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.click();
  await page.locator('.sc-mega a[href="/features/ai-assistant"]').click();
  await expect(page).toHaveURL(/\/features\/ai-assistant$/);
  await expect(page.locator("main h1")).toBeVisible();
});

test("mobile navigation locks scrolling, dismisses and navigates", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const open = page.getByRole("button", { name: "開啟導覽選單", exact: true });
  await open.click();
  const drawer = page.getByRole("dialog", { name: "導覽選單", exact: true });
  await expect(drawer).toBeVisible();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");
  const bounds = await drawer.boundingBox();
  expect(bounds?.height).toBeGreaterThan(800);
  await page.keyboard.press("Escape");
  await expect(drawer).not.toBeVisible();
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
  await open.click();
  await drawer.getByRole("button", { name: "功能", exact: true }).click();
  await drawer.locator('a[href="/features/ai-assistant"]').click();
  await expect(page).toHaveURL(/\/features\/ai-assistant$/);
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
});

test("language switching preserves translated mobile layout", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Change language", exact: true }).click();
  await page.getByRole("menuitem", { name: "English", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator('footer a[href="/legal/privacy"]')).toHaveText("Privacy");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await expect(page.locator("main h1")).toBeVisible();
});

test("homepage anchors and signup CTA retain their destinations", async ({ page }) => {
  await page.goto("/");
  await page.locator('main a[href="#how"]').first().click();
  await expect(page).toHaveURL(/#how$/);
  await page.locator('.sc-navlinks a[href="/#pricing"]').click();
  await expect(page).toHaveURL(/#pricing$/);
  await page.locator("#pricing").getByRole("button").first().click();
  await expect(page).toHaveURL(/\/admin(?:[/?#].*)?$/);
});

test("homepage product preview, proof notes and pricing retain readable text contrast", async ({ page }) => {
  await page.goto("/");
  const selectors = [
    ".sc-room header", ".sc-room header b",
    ".sc-room-bottom article > p", ".sc-room-bottom article > span",
    ".sc-room-bottom aside > small", ".sc-room-bottom aside > b",
    ".sc-room-bottom aside > span",
    ".sc-plan-grid .featured .sc-price", ".sc-plan-grid .featured .sc-price small",
    ".sc-proof-notes article h3", ".sc-proof-notes article p", ".sc-proof-notes article > svg",
  ];
  for (const selector of selectors) {
    const ratios = await page.locator(selector).evaluateAll(elements => {
      const rgba = (value: string) => {
        const parts = value.match(/[\d.]+/g)?.map(Number) || [0, 0, 0];
        return [...parts.slice(0, 3), parts[3] ?? 1];
      };
      const luminance = (rgb: number[]) => rgb.slice(0, 3).map(value => {
        const s = value / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
      return elements.map(element => {
        const ancestors: Element[] = [];
        for (let node: Element | null = element; node; node = node.parentElement) ancestors.unshift(node);
        let background = [255, 255, 255];
        for (const node of ancestors) {
          const color = rgba(getComputedStyle(node).backgroundColor);
          background = background.map((value, index) => color[index] * color[3] + value * (1 - color[3]));
        }
        const foreground = luminance(rgba(getComputedStyle(element).color));
        const backdrop = luminance(background);
        return (Math.max(foreground, backdrop) + 0.05) / (Math.min(foreground, backdrop) + 0.05);
      });
    });
    expect(ratios.length, selector).toBeGreaterThan(0);
    for (const ratio of ratios) expect(ratio, selector).toBeGreaterThanOrEqual(4.5);
  }
});