import { expect, test, type Page } from "@playwright/test";

async function openViewer(page: Page, embed = false, timedMaterials = false) {
  await page.addInitScript(() => localStorage.setItem("sellcase.marketing-consent.v1", "denied"));
  await page.route("**/api/webinars/fullscreen-test**", route => {
    const path = new URL(route.request().url()).pathname;
    const data = path === "/api/webinars/fullscreen-test" ? {
      id: "fullscreen-test", title: "Fullscreen test", publishStatus: "published",
      vimeoUrl: "https://vimeo.com/123456789", scheduleMode: "on_demand",
      startTime: "2020-01-01T00:00:00Z", timezone: "UTC",
      replayEnabled: true,
    } : timedMaterials && path.endsWith("/scheduled-messages") ? [{
      id: "materials-1", webinarId: "fullscreen-test", fakeUserId: null, messageType: "assistant",
      message: "這是你的課程講義\nhttps://example.com/handout", triggerTime: 30,
    }, {
      id: "materials-2", webinarId: "fullscreen-test", fakeUserId: null, messageType: "assistant",
      message: "課後補充資料", triggerTime: 60,
    }] : path.endsWith("/progress") || path.includes("/progress/") ? {} : [];
    return route.fulfill({ json: data });
  });
  // Isolate layout and fullscreen from external video/network availability.
  await page.route("https://player.vimeo.com/**", route => route.fulfill({
    contentType: "text/html", body: "<html><body style='background:black;color:white'>Test video</body></html>",
  }));
  await page.route("https://player.vimeo.com/api/player.js", route => route.fulfill({
    contentType: "application/javascript",
    body: `window.Vimeo = { Player: class {
      constructor() { this.handlers = {}; window.__testPlayer = this; }
      on(event, fn) { this.handlers[event] = fn; } off() {} destroy() {}
      play() { window.__videoPlayCalls = (window.__videoPlayCalls || 0) + 1; if(window.__rejectPlay) return Promise.reject(new Error("Play denied")); this.handlers.play?.(); return Promise.resolve(); }
      pause() { this.handlers.pause?.(); return Promise.resolve(); } setMuted() { return Promise.resolve(); }
      setVolume() { return Promise.resolve(); } getDuration() { return Promise.resolve(3600); }
      getCurrentTime() { return Promise.resolve(0); }
      setCurrentTime(t) { return Promise.resolve(t); }
    } };`,
  }));
  await page.goto(`${embed ? "/embed" : ""}/webinar/fullscreen-test`);
  await page.getByTestId(embed ? "input-embed-nickname" : "input-nickname").fill("Viewer");
  await page.getByTestId(embed ? "button-embed-join" : "button-join").click();
  await expect(page.getByTestId("button-video-fullscreen")).toBeVisible();
  const bounds = await page.getByTestId("fullscreen-video-container").boundingBox();
  const playerBounds = await page.getByTestId(embed ? "embed-video-player" : "video-player").boundingBox();
  expect(bounds!.width).toBeGreaterThan(300);
  expect(bounds!.height).toBeGreaterThan(200);
  expect(playerBounds!.height).toBeGreaterThan(200);
}

for (const embed of [false, true]) {
  test(`${embed ? "embedded" : "standard"} assistant sends materials in chat at video times once without fake viewers`, async ({ page }) => {
    await openViewer(page, embed, true);
    const play = page.getByTestId(embed ? "button-embed-play-video" : "button-play-video");
    await play.click();
    const tick = (seconds: number) => page.evaluate(seconds => {
      (window as any).__testPlayer.handlers.timeupdate?.({ seconds, duration: 3600 });
    }, seconds);
    await tick(29);
    await expect(page.getByText("這是你的課程講義", { exact: false })).toHaveCount(0);
    await tick(30);
    const link = page.getByRole("link", { name: "https://example.com/handout", exact: true });
    await expect(link).toHaveCount(1);
    await expect(link).toHaveAttribute("href", "https://example.com/handout");
    await expect(page.getByText("小幫手", { exact: false }).first()).toBeVisible();
    await page.evaluate(() => (window as any).__testPlayer.pause());
    await tick(65);
    await expect(page.getByText("課後補充資料", { exact: true })).toHaveCount(0);
    await page.evaluate(() => (window as any).__testPlayer.play());
    await expect(page.getByText("課後補充資料", { exact: true })).toHaveCount(1);
    await tick(10);
    await tick(90);
    await expect(link).toHaveCount(1);
    await expect(page.getByText("課後補充資料", { exact: true })).toHaveCount(1);
  });

  test(`${embed ? "embedded" : "standard"} viewer can start playback and sees a rejected playback error`, async ({ page }) => {
    await openViewer(page, embed);
    const play = page.getByTestId(embed ? "button-embed-play-video" : "button-play-video");
    await expect(play).toBeEnabled();
    await play.click();
    await expect.poll(() => page.evaluate(() => (window as any).__videoPlayCalls)).toBe(1);
    await page.evaluate(() => { (window as any).__rejectPlay = true; });
    await play.click();
    await expect(page.getByText(/影片無法播放/).first()).toBeVisible();
  });

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
