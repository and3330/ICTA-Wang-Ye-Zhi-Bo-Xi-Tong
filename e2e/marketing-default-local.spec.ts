import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db, pool } from "../server/db";
import * as schema from "../shared/schema";

const ownerId = randomUUID();
const webinarId = randomUUID();
const memberPixel = "987654321001234";
const gtm = "GTM-SELLE2E";

test.beforeAll(async () => {
  await db.insert(schema.users).values({
    id: ownerId, username: `default-tracking-test-${ownerId}`,
    password: "not-a-login-hash", subscriptionPlan: "enterprise",
  });
  await db.insert(schema.webinars).values({
    id: webinarId, userId: ownerId, title: "行銷追蹤預設啟用測試",
    vimeoUrl: "", publishStatus: "published", startTime: new Date(Date.now() + 86_400_000),
    metaPixelId: memberPixel, gtmContainerId: gtm,
    scheduleMode: { recurring: false, onDemand: true, justInTime: false, justInTimeMinutes: 15 },
    // No test emails may be picked up by the real development worker.
    emailSettings: { confirmationEnabled: false, reminder24hEnabled: false, reminder1hEnabled: false, followUpEnabled: false, customSubject: "", customTemplate: "" },
  });
  await db.insert(schema.webinarLandingPages).values({
    webinarId, title: "行銷追蹤預設啟用測試", publishedTitle: "行銷追蹤預設啟用測試",
    status: "published", publishedBlocks: [], publishedAt: new Date(),
    publishedBrandSettings: { primaryColor: "#0f766e", secondaryColor: "#f59e0b", backgroundColor: "#ffffff" },
  });
});

test.afterAll(async () => {
  try {
    await db.delete(schema.emailReminders).where(eq(schema.emailReminders.webinarId, webinarId));
    await db.delete(schema.webinarFunnelEvents).where(eq(schema.webinarFunnelEvents.webinarId, webinarId));
    await db.delete(schema.registrationIdentityKeys).where(eq(schema.registrationIdentityKeys.webinarId, webinarId));
    await db.delete(schema.registrations).where(eq(schema.registrations.webinarId, webinarId));
    await db.delete(schema.webinarLandingPages).where(eq(schema.webinarLandingPages.webinarId, webinarId));
    await db.delete(schema.webinars).where(eq(schema.webinars.id, webinarId));
    await db.delete(schema.users).where(eq(schema.users.id, ownerId));
  } finally {
    await pool.end();
  }
});

for (const embed of [false, true]) {
  test(`${embed ? "embedded" : "public"} registration loads configured trackers by default and persists a real registration`, async ({ page }) => {
    // Cover both a clean visitor and a visitor with the obsolete denied setting.
    await page.addInitScript(legacy => {
      localStorage.clear();
      if (legacy) localStorage.setItem("sellcase.marketing-consent.v1", "denied");
    }, embed);
    const loaded: string[] = [];
    await page.route("https://connect.facebook.net/**", route => {
      loaded.push(route.request().url());
      return route.fulfill({
        contentType: "application/javascript",
        body: `window.__defaultTrackingCalls = [];
          const queue = window.fbq.queue || [];
          window.fbq.callMethod = (...args) => window.__defaultTrackingCalls.push(args);
          queue.splice(0).forEach(args => window.fbq.callMethod(...args));`,
      });
    });
    await page.route("https://www.facebook.com/**", route => route.abort());
    await page.route("https://www.googletagmanager.com/**", route => {
      loaded.push(route.request().url());
      return route.fulfill({ contentType: "application/javascript", body: "window.__gtmTestLoaded = true;" });
    });
    await page.goto(embed ? `/embed/register/${webinarId}` : `/register/${webinarId}`, { waitUntil: "domcontentloaded" });
    const submit = page.getByTestId(embed ? "button-embed-register" : "button-register");
    await expect(submit).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Cookie 與行銷追蹤設定" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "同意行銷追蹤" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "僅使用必要功能" })).toHaveCount(0);
    await expect.poll(() => loaded.some(url => url.includes("connect.facebook.net"))).toBe(true);
    await expect.poll(() => loaded.some(url => url.includes(`gtm.js?id=${gtm}`))).toBe(true);
    await expect.poll(() => page.evaluate(() => (window as any).__defaultTrackingCalls))
      .toContainEqual(["init", memberPixel]);
    const prefix = embed ? "input-embed-" : "input-";
    await page.getByTestId(`${prefix}name`).fill("Default tracking test");
    await page.getByTestId(`${prefix}phone`).fill("0912345678");
    await page.getByTestId(`${prefix}email`).fill(`${randomUUID()}@example.test`);
    await page.getByTestId(embed ? "button-embed-session-dropdown" : "select-session").click();
    await page.getByTestId(embed ? "button-embed-session-on-demand" : "option-session-on-demand").click();
    // A failed signup must not report a completed registration.
    await page.route("**/api/registrations", route => route.fulfill({ status: 400, json: { message: "測試拒絕報名" } }));
    await submit.click();
    await expect(page.getByText(/測試拒絕報名/).first()).toBeVisible();
    expect(await page.evaluate(() => window.dataLayer?.filter(event => event.event === "webinar_registration").length || 0)).toBe(0);
    await page.unroute("**/api/registrations");
    // The successful submission uses the actual development endpoint.
    const responsePromise = page.waitForResponse(response =>
      response.url().endsWith("/api/registrations") && response.request().method() === "POST");
    await submit.click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    const result = await response.json();
    const [stored] = await db.select({ id: schema.registrations.id, webinarId: schema.registrations.webinarId })
      .from(schema.registrations).where(eq(schema.registrations.id, result.id));
    expect(stored?.webinarId).toBe(webinarId);
    await expect.poll(() => page.evaluate(pixel =>
      ((window as any).__defaultTrackingCalls || []).filter((call: any[]) =>
        call[0] === "trackSingle" && call[1] === pixel && call[2] === "CompleteRegistration",
      ).length, memberPixel)).toBe(1);
    const conversions = await page.evaluate(() => ({
      meta: ((window as any).__defaultTrackingCalls || []).find((call: any[]) => call[2] === "CompleteRegistration"),
      gtm: window.dataLayer?.filter(event => event.event === "webinar_registration") || [],
    }));
    expect(conversions.meta[4].eventID).toBe(`registration_${result.id}`);
    expect(conversions.gtm).toHaveLength(1);
    expect(conversions.gtm[0].registration_id).toBe(result.id);
    await page.evaluate(({ webinarId, registrationId }) => {
      window.dispatchEvent(new CustomEvent("livecast:webinar-registration", { detail: { webinarId, registrationId } }));
    }, { webinarId, registrationId: result.id });
    expect(await page.evaluate(() => window.dataLayer?.filter(event => event.event === "webinar_registration").length)).toBe(1);
    await expect(submit).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Cookie 與行銷追蹤設定" })).toHaveCount(0);
  });
}
