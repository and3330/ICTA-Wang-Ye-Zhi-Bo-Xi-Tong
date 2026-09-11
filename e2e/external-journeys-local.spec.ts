import { expect, test, type Page } from "@playwright/test";

const webinarId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const orderId = "33333333-3333-4333-8333-333333333333";

async function mockExternalOrders(page: Page) {
  await page.addInitScript(() => localStorage.setItem("sellcase.marketing-consent.v1", "denied"));
  await page.route("**/api/member/external-orders**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/summary")) return route.fulfill({ json: {
      labelled: "External reports; not provider-verified revenue",
      currencies: [
        { currency: "TWD", sourceTrust: "browser_reported", grossPaidMinor: 1000, refundedMinor: 0, netMinor: 1000, count: 1 },
        { currency: "TWD", sourceTrust: "merchant_reported", grossPaidMinor: 3000, refundedMinor: 1000, netMinor: 2000, count: 1 },
      ],
    } });
    if (url.pathname.endsWith("/export.csv")) return route.fulfill({ body: "orderId\nexternal-1\n", headers: { "Content-Type": "text/csv" } });
    if (url.pathname.endsWith(`/${orderId}`)) return route.fulfill({ json: {
      id: orderId, orderId: "external-1", webinarId, sessionId, selectedSession: "2025-02-01T10:00:00.000Z",
      sourceTrust: "merchant_reported", currency: "TWD", grossPaidMinor: 3000, refundedMinor: 1000, netMinor: 2000,
      createdAt: "2025-02-01T10:00:00.000Z", updatedAt: "2025-02-01T10:00:00.000Z",
      labelled: "Read-only external report; not provider-verified revenue",
      events: [{ id: "event-1", eventId: "merchant-1", eventType: "refund", sourceTrust: "merchant_reported", amountMinor: 1000, currency: "TWD", occurredAt: "2025-02-01T10:00:00.000Z" }],
    } });
    return route.fulfill({ json: {
      items: [{ id: orderId, orderId: "external-1", webinarId, sessionId, selectedSession: "2025-02-01T10:00:00.000Z", sourceTrust: "merchant_reported", currency: "TWD", grossPaidMinor: 3000, refundedMinor: 1000, netMinor: 2000, createdAt: "2025-02-01T10:00:00.000Z", updatedAt: "2025-02-01T10:00:00.000Z" }],
      page: 1, pageSize: 25, total: 1, labelled: "External reports; not provider-verified revenue",
    } });
  });
}

test("external orders stay separate, filter by trust/session, and expose only safe totals", async ({ page }) => {
  await mockExternalOrders(page);
  await page.goto("/admin/orders?tab=external");
  await expect(page.getByTestId("external-orders-page")).toBeVisible();
  await expect(page.getByText("外部歸因報表，不是平台確認營收。")).toBeVisible();
  await expect(page.getByTestId("external-orders-summary-TWD-browser_reported")).toContainText("未驗證淨額");
  await page.getByTestId("external-orders-session").fill(sessionId);
  await expect.poll(() => new URL(page.url()).searchParams.get("externalSession")).toBe(sessionId);
  await page.getByTestId(`external-order-${orderId}`).click();
  await expect(page.getByTestId("external-order-detail")).toContainText("關聯場次");
  await expect(page.getByTestId("external-order-detail")).toContainText("商家簽名回報（未驗證）");
});

async function mockBuiltinForm(page: Page, registrationResponse: unknown) {
  await page.addInitScript(() => localStorage.setItem("sellcase.marketing-consent.v1", "denied"));
  await page.route(`**/api/webinars/${webinarId}/landing-page**`, route => route.fulfill({ json: { landingPage: { blocks: [] } } }));
  await page.route(`**/api/webinars/${webinarId}/available-sessions`, route => route.fulfill({ json: { mode: "onDemand", sessions: [] } }));
  await page.route(`**/api/webinars/${webinarId}/registration-count`, route => route.fulfill({ json: { count: 0 } }));
  await page.route(`**/api/webinars/${webinarId}`, route => route.fulfill({ json: {
    id: webinarId, title: "Built-in registration", description: "", publishStatus: "published",
    startTime: "2030-01-01T00:00:00.000Z", timezone: "UTC", registrationOpen: true,
  } }));
  await page.route("**/api/registrations", route => route.fulfill({ json: registrationResponse }));
}

test("/form is a built-in registration path and only follows server-issued HTTPS handoffs", async ({ page }) => {
  await page.route("https://receiver.example/**", route => route.fulfill({
    contentType: "text/html", body: "<main>External thank-you receiver</main>",
  }));
  await mockBuiltinForm(page, { registrationId: "44444444-4444-4444-8444-444444444444", externalThankYou: { redirectUrl: "https://receiver.example/thanks?handoff=opaque-one-use-token" } });
  await page.goto(`/form/${webinarId}`);
  await page.getByTestId("input-name").fill("表單觀眾");
  await page.getByTestId("input-phone").fill("0912345678");
  await page.getByTestId("input-email").fill("form@example.com");
  await Promise.all([
    page.waitForURL("https://receiver.example/**"),
    page.getByTestId("button-register").click(),
  ]);
  expect(new URL(page.url()).searchParams.get("handoff")).toBe("opaque-one-use-token");
});

test("draft preview and permanent built-in form do not use a marketing redirect", async ({ page }) => {
  await mockBuiltinForm(page, { registrationId: "44444444-4444-4444-8444-444444444444" });
  await page.goto(`/form/${webinarId}?preview=1`);
  await expect(page.getByTestId("input-name")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/form/${webinarId}\\?preview=1`));
});

test("external journey settings save/publish versions, keep secrets explicit, and expose consent-guarded install code", async ({ page }) => {
  const draft = { landingMode: "builtin", thankYouMode: "builtin", approvedOrigins: [], approvedEmbedOrigins: [], secureHandoffEnabled: false, includeWatchLinkInHandoff: false, includeContactInHandoff: false };
  let version = 1;
  let rotateCalls = 0;
  await page.addInitScript(() => {
    localStorage.setItem("sellcase.marketing-consent.v1", "denied");
    window.confirm = () => true;
  });
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === `/api/webinars/${webinarId}/external-journey`) {
      if (route.request().method() === "GET") return route.fulfill({ json: { version, settings: draft, publishedAt: null } });
      const body = route.request().postDataJSON(); version += 1; Object.assign(draft, body.settings);
      return route.fulfill({ json: { version, settings: draft, publishedAt: null } });
    }
    if (path === `/api/webinars/${webinarId}/external-journey/publish`) return route.fulfill({ json: { version, settings: draft, publishedAt: "2025-01-01T00:00:00.000Z" } });
    if (path === "/api/member/external-journeys/connection") return route.fulfill({ json: { connected: rotateCalls > 0, version: rotateCalls || null, rotatedAt: null, merchantEventsPath: "/api/external/merchant-events/:webinarId", handoffExchangePath: "/api/external/handoffs/exchange" } });
    if (path === "/api/member/external-journeys/connection/rotate") { rotateCalls++; return route.fulfill({ json: { secret: "shown-once-secret" } }); }
    if (path === "/api/member/external-journeys/events") return route.fulfill({ json: { items: [] } });
    if (path === `/api/webinars/${webinarId}`) return route.fulfill({ json: { id: webinarId, title: "Settings webinar", publishStatus: "published", startTime: "2030-01-01T00:00:00.000Z", timezone: "UTC" } });
    return route.fulfill({ json: [] });
  });
  await page.goto(`/admin/webinar/${webinarId}`);
  await page.getByTestId("tab-settings").click();
  await page.getByText("外部旅程與歸因", { exact: true }).click();
  await expect(page.getByTestId("external-journey-panel")).toBeVisible();
  await expect(page.getByTestId("external-secret-status")).toContainText("尚未建立密鑰");
  expect(rotateCalls).toBe(0);
  await page.getByTestId("external-save-draft").click();
  await expect.poll(() => version).toBe(2);
  await page.getByTestId("external-publish").click();
  await expect(page.getByText("外部旅程已發布", { exact: true })).toBeVisible();
  await expect(page.getByTestId("external-source-snippet")).toContainText("window.sellcaseTrackingConsent !== true");
  await expect(page.getByTestId("external-handoff-snippet")).toContainText("SELLCASE_EXTERNAL_SECRET");
  const sourceCode = await page.getByTestId("external-source-snippet").innerText();
  const reportCode = await page.getByTestId("external-thankyou-snippet").innerText();
  const reports = await page.evaluate(async ({ sourceCode, reportCode }) => {
    const values = new Map<string, string>();
    const bodies: unknown[] = [];
    const context = { sellcaseTrackingConsent: false, order: { id: "fixture-order", amountMinor: 1200, currency: "USD" } };
    const storage = { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => values.set(key, value) };
    const mockFetch = async (_url: string, options: RequestInit) => { bodies.push(JSON.parse(String(options.body))); return { ok: true }; };
    const run = (code: string) => new Function("window", "location", "sessionStorage", "fetch", code.replace(/<\/?script>/g, ""))(context, { search: "?sc_ref=fixture-reference" }, storage, mockFetch);
    run(sourceCode); run(reportCode);
    const beforeConsent = bodies.length;
    context.sellcaseTrackingConsent = true;
    run(sourceCode); run(reportCode);
    await Promise.resolve();
    return { beforeConsent, bodies };
  }, { sourceCode, reportCode });
  expect(reports.beforeConsent).toBe(0);
  expect(reports.bodies).toEqual([{ scRef: "fixture-reference", orderId: "fixture-order", amountMinor: 1200, currency: "USD" }]);
  await page.getByTestId("external-rotate-secret").click();
  await expect(page.getByTestId("external-secret-status")).toContainText("shown-once-secret");
  expect(rotateCalls).toBe(1);
  await page.getByTestId("external-journey-panel").screenshot({ path: "/tmp/external-journey-panel-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId("external-journey-panel").screenshot({ path: "/tmp/external-journey-panel-mobile.png" });
});