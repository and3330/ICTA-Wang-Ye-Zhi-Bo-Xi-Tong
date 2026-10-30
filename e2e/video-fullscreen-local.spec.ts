import { expect, test, type Page } from "@playwright/test";

async function openViewer(page: Page, embed = false) {
  await page.addInitScript(() => localStorage.setItem("sellcase.marketing-consent.v1", "denied"));
  await page.route("**/api/webinars/fullscreen-test**", route => {
    const path = new URL(route.request().url()).pathname;
    const data = path === "/api/webinars/fullscreen-test" ? {
      id: "fullscreen-test", title: "Fullscreen test", publishStatus: "published",
      vimeoUrl: "https://vimeo.com/123456789", scheduleMode: "on_demand",
      startTime: "2020-01-01T00:00:00Z", timezone: "UTC",
      replayEnabled: true,
    } : path.endsWith("/progress") || path.includes("/progress/") ? {} : [];
    return route.fulfill({ json: data });
  });
  // Isolate layout and fullscreen from external video/network availability.
  await page.route("https://player.vimeo.com/**", route => route.fulfill({
    contentType: "text/html", body: "<html><body style='background:black;color:white'>Test video</body></html>",
  }));
  await page.route("https://player.vimeo.com/api/player.js", route => route.fulfill({
    contentType: "application/javascript",
    body: `window.Vimeo = { Player: class {
      on() {} destroy() {} play() { return Promise.resolve(); }
      pause() { return Promise.resolve(); } setMuted() { return Promise.resolve(); }
      setVolume() { return Promise.resolve(); } getDuration() { return Promise.resolve(3600); }
      getCurrentTime() { return Promise.resolve(0); }
      setCurrentTime(t) { return Promise.resolve(t); }
    } };`,
  }));
  await page.goto(`${embed ? "/embed" : ""}/webinar/fullscreen-test`);
  await page.getByTestId(embed ? "input-embed-nickname" : "input-nickname").fill("Viewer");
  await page.getByTestId(embed ? "button-embed-join" : "button-join").click();
  await expect(page.getByTestId("button-video-fullscreen")).toBeVisible();
}

for (const embed of [false, true]) {
  test(`${embed ? "embedded" : "standard"} viewer enters and exits native fullscreen without reloading video`, async ({ page }) => {
    await openViewer(page, embed);
    const frame = page.getByTestId(embed ? "embed-video-player" : "video-player");
    await frame.evaluate(element => element.setAttribute("data-player-preserved", "yes"));
    const button = page.getByTestId("button-video-fullscreen");
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => page.evaluate(() => document.fullscreenElement?.getAttribute("data-testid"))).toBe("fullscreen-video-container");
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "false");
    await expect(frame).toHaveAttribute("data-player-preserved", "yes");
    await expect(page.getByTestId("support-contact-widget")).toHaveCount(0);
  });
}

test("mobile falls back to viewport expansion and Escape restores layout", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    Element.prototype.requestFullscreen = () => Promise.reject(new Error("Fullscreen permission denied"));
  });
  await openViewer(page);
  const button = page.getByTestId("button-video-fullscreen");
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(button).toHaveAttribute("aria-pressed", "true");
  const container = page.getByTestId("fullscreen-video-container");
  await expect(container).toHaveCSS("position", "fixed");
  const bounds = await container.boundingBox();
  expect(bounds?.width).toBe(390);
  expect(bounds?.height).toBe(844);
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
  await page.keyboard.press("Escape");
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await expect(container).toHaveCSS("position", "relative");
  await expect(button).toBeFocused();
  await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
});
