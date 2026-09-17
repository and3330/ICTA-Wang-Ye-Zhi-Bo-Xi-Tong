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

test("platform pixel base code loads in head on every page and counts SPA route changes", async ({ page }) => {
  const requests = await setup(page);
  await page.goto("/");
  // The base code runs before any consent choice.
  await expect(page.getByRole("button", { name: "同意行銷追蹤" })).toBeVisible();
  await expect.poll(() => calls(page)).toContainEqual(["track", "PageView"]);
  expect(requests).toHaveLength(1);
  expect(await calls(page)).toContainEqual(["set", "autoConfig", false, pixel]);
  expect((await calls(page)).filter((c: string[]) => c[0] === "init" && c[1] === pixel)).toHaveLength(1);
  const pageViews = async () => (await calls(page)).filter((c: string[]) => c[0] === "track" || (c[0] === "trackSingle" && c[2] === "PageView")).length;
  expect(await pageViews()).toBe(1);
  await navigate(page, "/features");
  await expect.poll(pageViews).toBe(2);
  await navigate(page, "/admin");
  await expect(page).toHaveURL(/\/admin$/);
  await expect.poll(pageViews).toBe(3);
  await page.getByRole("button", { name: "僅使用必要功能" }).click();
  await navigate(page, "/solutions");
  await expect.poll(pageViews).toBe(4);
  expect((await calls(page)).some((c: string[]) => c[0] === "consent")).toBe(false);
  expect((await calls(page)).filter((c: string[]) => c[0] === "init" && c[1] === pixel)).toHaveLength(1);
  expect(requests).toHaveLength(1);
});

for (const path of ["/admin", "/sales/missing", "/form/missing", "/webinar/missing", "/purchase-result", "/legal/privacy"]) {
  test(`platform pixel base code is present on ${path}`, async ({ page }) => {
    const requests = await setup(page, "denied");
    await page.goto(path);
    await expect(page.locator("#root")).not.toBeEmpty();
    // After a choice the consent UI is gone entirely (no floating button).
    await expect(page.getByRole("dialog", { name: "Cookie 與行銷追蹤設定" })).toHaveCount(0);
    await expect.poll(() => calls(page)).toContainEqual(["track", "PageView"]);
    expect(requests).toHaveLength(1);
    expect((await calls(page)).filter((c: string[]) => c[0] === "init")).toEqual([["init", pixel]]);
  });
}

test("webinar events target only that member's pixel after marketing navigation", async ({ page }) => {
  await setup(page, "granted");
  await page.goto("/");
  await expect.poll(() => calls(page)).toContainEqual(["track", "PageView"]);
  await page.route("**/api/webinars/demo", route => route.fulfill({ json: {
    id: "demo", title: "Demo", publishStatus: "published", metaPixelId: "123456789",
  } }));
  await page.route("**/api/webinars/demo/**", route => route.fulfill({ json: {} }));
  await page.route("**/api/webinars/demo/available-sessions", route => route.fulfill({ json: {
    mode: "fixed", sessions: [], hasSessions: false, registrationOpen: true,
  } }));
  await navigate(page, "/register/demo");
  await expect.poll(() => calls(page)).toContainEqual(["init", "123456789"]);
  // Member pixels run without automatic events as well.
  expect(await calls(page)).toContainEqual(["set", "autoConfig", false, "123456789"]);
  await expect(page.locator("#registration-form")).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("livecast:webinar-event", {
    detail: { webinarId: "demo", eventType: "cta_click", data: {} },
  })));
  await expect.poll(() => calls(page)).toContainEqual(["trackSingle", "123456789", "Contact", { webinar_id: "demo" }]);
  // Only the head base code may broadcast, and only before any member pixel exists.
  const all = await calls(page);
  const memberInit = all.findIndex((c: string[]) => c[0] === "init" && c[1] === "123456789");
  expect(all.slice(memberInit).some((c: string[]) => c[0] === "track")).toBe(false);
  // Head PageView + one SPA route change to the member page.
  expect(all.filter((c: string[]) => c[0] === "trackSingle" && c[1] === pixel)).toEqual([["trackSingle", pixel, "PageView"]]);
  expect(all.filter((c: string[]) => c[0] === "trackSingle" && c[1] === "123456789" && c[2] === "PageView")).toHaveLength(0);
});
test("withdrawing consent after leaving a member page stops member events but keeps platform page views", async ({ page }) => {
  await setup(page, "granted");
  await page.route("**/api/webinars/demo", route => route.fulfill({ json: {
    id: "demo", title: "Demo", publishStatus: "published", metaPixelId: "123456789",
  } }));
  await page.route("**/api/webinars/demo/**", route => route.fulfill({ json: {} }));
  await page.route("**/api/webinars/demo/available-sessions", route => route.fulfill({ json: {
    mode: "fixed", sessions: [], hasSessions: false, registrationOpen: true,
  } }));
  await page.goto("/admin");
  await navigate(page, "/register/demo");
  await expect.poll(() => calls(page)).toContainEqual(["init", "123456789"]);
  await navigate(page, "/");
  await expect.poll(async () => (await calls(page)).filter((c: string[]) => c[0] === "trackSingle" && c[1] === pixel).length).toBe(2);
  // The footer link re-opens the dialog.
  await page.getByRole("link", { name: "開啟 Cookie 與行銷追蹤設定" }).click();
  await page.getByRole("button", { name: "僅使用必要功能" }).click();
  await navigate(page, "/register/demo");
  await expect(page.locator("#registration-form")).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("livecast:webinar-event", {
    detail: { webinarId: "demo", eventType: "cta_click", data: {} },
  })));
  await page.waitForTimeout(250);
  const all = await calls(page);
  expect(all.filter((c: string[]) => c[1] === "123456789" && c[0] === "trackSingle")).toHaveLength(0);
  expect(all.filter((c: string[]) => c[0] === "trackSingle" && c[1] === pixel)).toHaveLength(3);
});
