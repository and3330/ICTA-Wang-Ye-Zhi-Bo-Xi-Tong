import { expect, test } from "@playwright/test";

for (const width of [390, 768, 1000, 1280, 1600]) {
  test(`homepage sections have full-width backgrounds and balanced gutters at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => localStorage.setItem("sellcase.marketing-consent.v1", "denied"));
    await page.goto("/");
    await expect(page.locator(".sc-pricing")).toBeVisible();
    const layout = await page.evaluate(() => {
      const rect = (selector: string) => {
        const el = document.querySelector(selector)!;
        const bounds = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return { left: bounds.left, right: bounds.right, width: bounds.width, paddingLeft: parseFloat(style.paddingLeft), paddingRight: parseFloat(style.paddingRight) };
      };
      return {
        viewport: document.documentElement.clientWidth,
        how: rect(".sc-how"), steps: rect(".sc-how ol"),
        pricing: rect(".sc-pricing"), plans: rect(".sc-plan-grid"),
        title: rect(".sc-pricing header"), lead: rect(".sc-pricing header > p"),
        cards: [...document.querySelectorAll(".sc-plan-grid article")].map(el => {
          const r = el.getBoundingClientRect();
          return { left: r.left, right: r.right };
        }),
      };
    });
    for (const section of [layout.how, layout.pricing]) {
      expect(section.left).toBeCloseTo(0, 0);
      expect(section.width).toBeCloseTo(layout.viewport, 0);
      expect(section.paddingLeft).toBeGreaterThanOrEqual(20);
      expect(section.paddingLeft).toBeCloseTo(section.paddingRight, 0);
    }
    for (const content of [layout.steps, layout.plans]) {
      expect(content.left).toBeGreaterThanOrEqual(20);
      expect(layout.viewport - content.right).toBeCloseTo(content.left, 0);
    }
    for (const card of layout.cards) {
      expect(card.left).toBeGreaterThanOrEqual(19);
      expect(card.right).toBeLessThanOrEqual(layout.viewport - 19);
    }
    if (width > 760) expect(layout.lead.left).toBeCloseTo(layout.title.left, 0);
    if (width === 1280) {
      await page.locator("#how").screenshot({ path: "/tmp/home-how-fixed.png" });
      await page.locator("#pricing").screenshot({ path: "/tmp/home-pricing-fixed.png" });
    }
  });
}