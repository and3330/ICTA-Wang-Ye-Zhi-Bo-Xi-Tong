import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("sellcase.marketing-consent.v1", "denied"));
});

test("support bubble exposes the three contact channels and restores focus", async ({ page }) => {
  await page.goto("/");
  const trigger = page.getByTestId("button-support-contact");
  await trigger.click();

  await expect(page.getByTestId("support-option-line-community")).toHaveAttribute("href", "https://line.me/ti/g2/nr8aEvgzk5EhiMSIxRU3XynEk_eRA4hnIr6wXw?utm_source=invitation&utm_medium=link_copy&utm_campaign=default");
  await expect(page.getByTestId("support-option-line-official")).toHaveAttribute("href", "https://lin.ee/zUwGOFL");
  await expect(page.getByTestId("support-option-whatsapp")).toHaveAttribute("href", "https://wa.me/85251648207");
  for (const link of await page.getByTestId("support-contact-menu").locator("a").all()) {
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  }

  await page.getByRole("button", { name: "關閉客服選單" }).click();
  await expect(page.getByTestId("support-contact-menu")).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("support bubble closes on SPA navigation and stays hidden in embeds", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("button-support-contact").click();
  await page.evaluate(() => {
    history.pushState(null, "", "/pricing");
    dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page).toHaveURL(/\/pricing$/);
  await expect(page.getByTestId("support-contact-menu")).toHaveCount(0);

  await page.getByTestId("button-support-contact").click();
  await page.evaluate(() => {
    history.pushState(null, "", "/embed/register/test");
    dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page.getByTestId("support-contact-widget")).toHaveCount(0);

  await page.goBack();
  await expect(page.getByTestId("button-support-contact")).toHaveAttribute("aria-expanded", "false");
});