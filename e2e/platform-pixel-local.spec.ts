import { expect, test, type Page } from "@playwright/test";

const pixel = "1096741902746313";
async function setup(page: Page, consent?: string) {
  if (consent) await page.addInitScript(value => localStorage.setItem("sellcase.marketing-consent.v1", value), consent);
  const requests: string[] = [];
  await page.route("https://connect.facebook.net/**", async route => {
    requests.push(route.request().url());
    await route.fulfill({ contentType: "application/javascript", body: `
      window.__pixelCalls = window.__pixelCalls || [];
      const q = window.fbq.queue || [];
      window.fbq.callMethod = (...args) => window.__pixelCalls.push(args);
      q.splice(0).forEach(args => window.fbq.callMethod(...args));
    ` });
  });
  await page.route("https://www.facebook.com/**", route => route.abort());
  return requests;
}
const calls = (page: Page) => page.evaluate(() => (window as any).__pixelCalls || []);
const navigate = (page: Page, path: string) => page.evaluate(path => {
  history.pushState(null, "", path);
}, path);

test("pixel waits for consent, sends scoped PageView and stops after withdrawal", async ({ page }) => {
  const requests = await setup(page);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "同意行銷追蹤" })).toBeVisible();
  expect(requests).toHaveLength(0);
  await page.getByRole("button", { name: "同意行銷追蹤" }).click();
  await expect.poll(() => calls(page)).toContainEqual(["trackSingle", pixel, "PageView"]);
  expect(requests).toHaveLength(1);
  expect(await calls(page)).toContainEqual(["set", "autoConfig", false, pixel]);
  await navigate(page, "/features");
  await expect.poll(async () => (await calls(page)).filter((c: string[]) => c[0] === "trackSingle").length).toBe(2);
  await navigate(page, "/admin");
  await expect(page).toHaveURL(/\/admin$/);
  await page.getByRole("button", { name: "開啟 Cookie 與行銷追蹤設定" }).click();
  await page.getByRole("button", { name: "僅使用必要功能" }).click();
  await expect.poll(() => calls(page)).toContainEqual(["consent", "revoke"]);
  await navigate(page, "/solutions");
  await expect(page).toHaveURL(/\/solutions$/);
  expect((await calls(page)).filter((c: string[]) => c[0] === "trackSingle")).toHaveLength(2);
  await page.getByRole("button", { name: "開啟 Cookie 與行銷追蹤設定" }).click();
  await page.getByRole("button", { name: "同意行銷追蹤" }).click();
  await expect.poll(async () => (await calls(page)).filter((c: string[]) => c[0] === "trackSingle").length).toBe(3);
  expect((await calls(page)).filter((c: string[]) => c[0] === "init" && c[1] === pixel)).toHaveLength(1);
});

for (const path of ["/admin", "/sales/missing", "/register/missing", "/form/missing", "/webinar/missing", "/purchase-result", "/legal/privacy"]) {
  test(`platform pixel is excluded on ${path}`, async ({ page }) => {
    const requests = await setup(page, "granted");
    const response = await page.goto(path);
    if (path === "/register/missing") {
      expect(response?.status()).toBe(404);
    } else {
      await expect(page.getByRole("button", { name: "開啟 Cookie 與行銷追蹤設定" })).toBeVisible();
    }
    expect(requests).toHaveLength(0);
    expect(await calls(page)).toEqual([]);
  });
}

test("webinar events target only that member's pixel after marketing navigation", async ({ page }) => {
  await setup(page, "granted");
  await page.goto("/");
  await expect.poll(() => calls(page)).toContainEqual(["trackSingle", pixel, "PageView"]);
  await page.route("**/api/webinars/demo", route => route.fulfill({ json: {
    id: "demo", title: "Demo", publishStatus: "published", metaPixelId: "123456789",
  } }));
  await page.route("**/api/webinars/demo/**", route => route.fulfill({ json: {} }));
  await page.route("**/api/webinars/demo/available-sessions", route => route.fulfill({ json: {
    mode: "fixed", sessions: [], hasSessions: false, registrationOpen: true,
  } }));
  await navigate(page, "/register/demo");
  await expect.poll(() => calls(page)).toContainEqual(["init", "123456789"]);
  await expect(page.locator("#registration-form")).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("livecast:webinar-event", {
    detail: { webinarId: "demo", eventType: "cta_click", data: {} },
  })));
  await expect.poll(() => calls(page)).toContainEqual(["trackSingle", "123456789", "Contact", { webinar_id: "demo" }]);
  // Inspect all emitted marketing calls; none may use the broadcast command.
  expect((await calls(page)).some((c: string[]) => c[0] === "track")).toBe(false);
  expect((await calls(page)).filter((c: string[]) => c[0] === "trackSingle" && c[1] === pixel)).toHaveLength(1);
});