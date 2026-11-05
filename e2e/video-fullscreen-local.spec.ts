import { expect, test, type Page } from "@playwright/test";

async function openViewer(page: Page, embed = false, timedMaterials = false, inlinePolls = false) {
  await page.addInitScript(() => localStorage.setItem("sellcase.marketing-consent.v1", "denied"));
  await page.route("**/api/webinars/fullscreen-test**", route => {
    const path = new URL(route.request().url()).pathname;
    const data = path === "/api/webinars/fullscreen-test" ? {
      id: "fullscreen-test", title: "Fullscreen test", publishStatus: "published",
      vimeoUrl: "https://vimeo.com/123456789", scheduleMode: "on_demand",
      startTime: "2020-01-01T00:00:00Z", timezone: "UTC",
      replayEnabled: true,
    } : inlinePolls && path.endsWith("/polls") ? [{
      id: "poll-a", webinarId: "fullscreen-test", question: "你想先學哪一項？", options: ["自動化", "內容"], triggerTime: 30, duration: 60,
    }, {
      id: "poll-b", webinarId: "fullscreen-test", question: "你希望如何學習？", options: ["實作", "案例"], triggerTime: 30, duration: 60,
    }, {
      id: "poll-expire", webinarId: "fullscreen-test", question: "短時間投票", options: ["有", "沒有"], triggerTime: 31, duration: 1,
    }] : timedMaterials && path.endsWith("/ctas") ? [{
      id: "f768b343-e9f6-4694-bb5b-68226fe2ad53", webinarId: "fullscreen-test",
      text: "取得優惠", url: "https://example.com/cta-target", offerId: null,
      startTime: 30, endTime: null, style: "primary",
    }] : timedMaterials && path.endsWith("/tips") ? [{
      id: "tip-1", webinarId: "fullscreen-test", title: "第一個重點", content: "這是第一段提示", triggerTime: 20, duration: 1,
    }, {
      id: "tip-2", webinarId: "fullscreen-test", title: "第二個重點", content: "這是第二段提示", triggerTime: 20, duration: 1,
    }] : timedMaterials && path.endsWith("/scheduled-messages") ? [{
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
  test(`${embed ? "embedded" : "standard"} polls are independent inline chat cards with votes, live polls and expiry`, async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__sentVotes = [];
      (window as any).WebSocket = class {
        static OPEN = 1; static CONNECTING = 0;
        readyState = 1; onopen: any; onmessage: any;
        constructor() { (window as any).__pollSocket = this; setTimeout(() => this.onopen?.(), 0); }
        emit(type: string, data: any) { this.onmessage?.({ data: JSON.stringify({ type, data }) }); }
        send(raw: string) {
          const message = JSON.parse(raw);
          if (message.type === "join") setTimeout(() => this.emit("sessionConfirmed", { sessionId: "inline-poll-test" }), 0);
          if (message.type === "vote") {
            (window as any).__sentVotes.push(message.data);
            setTimeout(() => this.emit("pollResults", { pollId: message.data.pollId, results: { [message.data.optionIndex]: 1 } }), 20);
          }
        }
        close() { this.readyState = 3; }
      };
    });
    await openViewer(page, embed, false, true);
    await page.getByTestId(embed ? "button-embed-play-video" : "button-play-video").click();
    await page.evaluate(() => (window as any).__testPlayer.handlers.timeupdate({ seconds: 30, duration: 3600 }));
    const a = page.getByTestId("chat-poll-poll-a");
    const b = page.getByTestId("chat-poll-poll-b");
    await expect(a).toBeVisible();
    await expect(b).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(a.getByRole("button", { name: "提交投票" })).toBeDisabled();
    await a.getByRole("radio", { name: "自動化", exact: true }).focus();
    await page.keyboard.press("Space");
    await page.evaluate(() => { (window as any).__pollSocket.readyState = 3; });
    await a.getByRole("button", { name: "提交投票" }).click();
    await expect(a.getByRole("alert")).toContainText("連線中斷");
    await page.evaluate(() => { (window as any).__pollSocket.readyState = 1; });
    await a.getByRole("button", { name: "提交投票" }).click();
    await expect(a.getByRole("img", { name: /自動化：100%/ })).toBeVisible();
    await expect(b.getByRole("button", { name: "提交投票" })).toBeVisible();
    await b.getByRole("radio", { name: "案例", exact: true }).click();
    await b.getByRole("button", { name: "提交投票" }).click();
    await expect(b.getByRole("img", { name: /案例：100%/ })).toBeVisible();
    expect(await page.evaluate(() => (window as any).__sentVotes.map((v: any) => [v.pollId, v.optionIndex]))).toEqual([["poll-a", 0], ["poll-b", 1]]);
    await page.evaluate(() => (window as any).__pollSocket.emit("poll", { id: "live-poll", question: "主辦人即時投票", options: ["可以", "稍後"], duration: 60, triggerTime: 0 }));
    const live = page.getByTestId("chat-poll-live-poll");
    await expect(live).toBeVisible();
    await live.getByRole("button", { name: "略過", exact: true }).click();
    await expect(live.getByText(/略過/)).toBeVisible();
    await page.evaluate(() => (window as any).__testPlayer.handlers.timeupdate({ seconds: 31, duration: 3600 }));
    const expired = page.getByTestId("chat-poll-poll-expire");
    await expect(expired.getByText("投票已結束", { exact: true })).toBeVisible();
    await page.evaluate(() => (window as any).__testPlayer.handlers.timeupdate({ seconds: 30, duration: 3600 }));
    await expect(a).toHaveCount(1);
    await expect(b).toHaveCount(1);
    await expect(a.getByRole("img", { name: /自動化：100%/ })).toBeVisible();
  });

  test(`${embed ? "embedded" : "standard"} tips stay in chat and CTA links navigate even when script popups are blocked`, async ({ page }) => {
    await openViewer(page, embed, true);
    await page.route("https://example.com/**", route => route.fulfill({ contentType: "text/html", body: "Configured CTA destination" }));
    await page.getByTestId(embed ? "button-embed-play-video" : "button-play-video").click();
    await page.evaluate(() => (window as any).__testPlayer.handlers.timeupdate({ seconds: 30, duration: 3600 }));
    await expect(page.getByText("第一個重點", { exact: false })).toHaveCount(1);
    await expect(page.getByText("第二個重點", { exact: false })).toHaveCount(1);
    await expect(page.getByTestId("tip-card-desktop")).toHaveCount(0);
    await expect(page.getByTestId("tip-card-mobile")).toHaveCount(0);
    await expect(page.getByTestId("embed-tip-card")).toHaveCount(0);
    const cta = page.getByRole("link", { name: "取得優惠", exact: true });
    await expect(cta).toHaveAttribute("href", "https://example.com/cta-target");
    const normalPopup = page.waitForEvent("popup");
    await cta.click();
    const normal = await normalPopup;
    await expect(normal).toHaveURL("https://example.com/cta-target");
    await normal.close();
    await page.evaluate(() => { window.open = () => null; });
    const nativePopup = page.waitForEvent("popup");
    await cta.focus();
    await page.keyboard.press("Enter");
    const native = await nativePopup;
    await expect(native).toHaveURL("https://example.com/cta-target");
    await native.close();
    await page.evaluate(() => (window as any).__testPlayer.handlers.timeupdate({ seconds: 5, duration: 3600 }));
    await page.evaluate(() => (window as any).__testPlayer.handlers.timeupdate({ seconds: 100, duration: 3600 }));
    await expect(page.getByText("第一個重點", { exact: false })).toHaveCount(1);
    await expect(page.getByText("第二個重點", { exact: false })).toHaveCount(1);
  });

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
