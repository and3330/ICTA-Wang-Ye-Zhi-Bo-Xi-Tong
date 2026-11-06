import { test, expect, type BrowserContext } from "@playwright/test";
import { createLiveTrackingFixture, closeLiveFixturePool } from "./helpers/live-tracking-fixture";

test.use({ trace: "off", video: "off", screenshot: "off" });
type Fixture = Awaited<ReturnType<typeof createLiveTrackingFixture>>;
type RequestEvidence = { host: string; path: string; action: string };

async function protect(context: BrowserContext, baseURL: string, fixture: Fixture, container: string) {
  const host = new URL(baseURL).hostname;
  if (!host.endsWith(".replit.dev") && !["localhost", "127.0.0.1"].includes(host)) throw new Error("Development URL required");
  const network: RequestEvidence[] = [];
  const redirects: string[] = [];
  await context.routeWebSocket("**", socket => socket.close());
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== host) {
      if (url.hostname === "player.vimeo.com") {
        network.push({ host: url.hostname, path: url.pathname, action: "stubbed-media-no-egress" });
        if (url.pathname === "/api/player.js") return route.fulfill({ contentType: "application/javascript", body: `
          window.Vimeo = { Player: class {
            constructor(){ this.handlers = {}; }
            on(name, callback){ this.handlers[name] = callback; }
            off(name){ delete this.handlers[name]; }
            ready(){ return Promise.resolve(); }
            getDuration(){ return Promise.resolve(3600); }
            getCurrentTime(){ return Promise.resolve(0); }
            getPaused(){ return Promise.resolve(true); }
            getMuted(){ return Promise.resolve(true); }
            getVolume(){ return Promise.resolve(0); }
            setVolume(){ return Promise.resolve(); }
            setMuted(){ return Promise.resolve(); }
            setCurrentTime(){ return Promise.resolve(0); }
            play(){ this.handlers.play?.(); return Promise.resolve(); }
            pause(){ this.handlers.pause?.(); return Promise.resolve(); }
            destroy(){ return Promise.resolve(); }
          }};
        ` });
        return route.fulfill({ contentType: "text/html", body: `<!doctype html><script>
          window.addEventListener("message", event => {
            let message; try { message = typeof event.data === "string" ? JSON.parse(event.data) : event.data; } catch { return; }
            if (!message || !message.method) return;
            const values = { getDuration: 3600, getCurrentTime: 0, getVideoId: 123456789, getPaused: true, getMuted: true };
            parent.postMessage(JSON.stringify({ method: message.method, value: values[message.method] ?? message.value ?? null }), "*");
          });
          parent.postMessage(JSON.stringify({event:"ready"}), "*");
        </script>` });
      }
      if (/googletagmanager|google-analytics|facebook\.|connect\.facebook|noncodingai/.test(url.hostname) || /collect/.test(url.pathname)) {
        // Strip all query strings, headers, cookies, tokens and personal data.
        const action = url.hostname === "www.googletagmanager.com" && url.searchParams.get("id") === "GTM-DEVTEST1"
          ? "stubbed-no-egress" : url.hostname === "noncodingai.com" ? "stubbed-destination-no-egress" : "blocked";
        network.push({ host: url.hostname, path: url.pathname, action });
        if (action === "stubbed-no-egress") return route.fulfill({ contentType: "application/javascript", body: "/* inert test container; no collection */" });
        if (action === "stubbed-destination-no-egress") return route.fulfill({ contentType: "text/html", body: "<main>External navigation intercepted; no external request sent.</main>" });
        return route.abort();
      }
      // Development Clerk SDK is needed by the real App root. No user signs in.
      if (url.hostname.endsWith(".clerk.accounts.dev")) return route.continue();
      return route.abort();
    }
    if (url.pathname.startsWith("/r/")) {
      // Playwright may follow an intercepted request's redirect chain without
      // calling the route handler again. NEVER continue /r/ to the real site.
      const response = await route.fetch({ maxRedirects: 0 });
      if (response.status() !== 302) throw new Error("Expected real dev referral redirect");
      const destination = response.headers().location;
      if (!destination || new URL(destination).origin !== "https://noncodingai.com") throw new Error("Unexpected referral destination");
      redirects.push(destination);
      network.push({ host, path: "/r/<redacted>", action: "302-captured-not-followed" });
      return route.fulfill({ contentType: "text/html", body: "<main>Verified redirect captured without visiting external checkout.</main>" });
    }
    if (url.pathname === `/api/webinars/${fixture.webinarId}`) {
      const response = await route.fetch();
      const webinar = await response.json();
      // DB remains is_test=true. Only this browser response exercises the
      // ordinary organizer-tracking branch, otherwise test rooms skip ALL GTM.
      return route.fulfill({ response, json: { ...webinar, isTest: false, metaPixelId: null, gtmContainerId: container } });
    }
    // Do not create mail/webhook jobs through attendance; registration was
    // inserted directly as a synthetic test fixture.
    if (url.pathname.startsWith("/api/registrations/") && route.request().method() !== "GET") return route.fulfill({ json: { ok: true } });
    return route.continue();
  });
  return { network, redirects };
}

function summarize(network: RequestEvidence[]) {
  const counts = new Map<string, RequestEvidence & { count: number }>();
  for (const request of network) {
    const key = `${request.host}|${request.path}|${request.action}`;
    const previous = counts.get(key);
    counts.set(key, { ...request, count: (previous?.count || 0) + 1 });
  }
  return [...counts.values()];
}

test.describe("real development registration/room pages", () => {
  test.describe.configure({ mode: "serial" });
  let fixture: Fixture;
  test.beforeAll(async () => { fixture = await createLiveTrackingFixture(); });
  test.afterAll(async () => { if (fixture) await fixture.cleanup(); await closeLiveFixturePool(); });

  test("real /form initializes a valid-format nonproduction container once on the same page", async ({ page, baseURL }) => {
    const { network } = await protect(page.context(), baseURL!, fixture, "GTM-DEVTEST1");
    await page.goto(`/form/${fixture.webinarId}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("input-name")).toBeVisible();
    await expect(page.locator('script[data-livecast-tracking="gtm"]')).toHaveCount(1);
    await page.evaluate(async () => {
      const path = "/src/lib/gtm-runtime.ts";
      const { loadGtm } = await import(/* @vite-ignore */ path);
      loadGtm("GTM-DEVTEST1"); loadGtm("GTM-DEVTEST1");
    });
    expect(await page.evaluate(() => window.dataLayer?.filter(e => e.event === "gtm.js").length)).toBe(1);
    expect(network.filter(r => r.host === "www.googletagmanager.com" && r.path === "/gtm.js").length).toBe(1);
    console.log(JSON.stringify({ case: "real-form-dedup", url: `${baseURL}/form/${fixture.webinarId}`,
      scriptInitializations: 1, realGoogleRequestsAllowed: 0, network: summarize(network) }));
  });

  test("real /form blocks production GTM loading and both webinar forwarding paths", async ({ page, baseURL }) => {
    const { network } = await protect(page.context(), baseURL!, fixture, "GTM-NVHG4XMR");
    await page.goto(`/form/${fixture.webinarId}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("input-name")).toBeVisible();
    await page.evaluate(async ({ webinarId, registrationId }) => {
      const path = "/src/lib/gtm-runtime.ts";
      const { loadGtm } = await import(/* @vite-ignore */ path);
      loadGtm("GTM-NVHG4XMR"); loadGtm("GTM-NVHG4XMR");
      window.dispatchEvent(new CustomEvent("livecast:webinar-event", { detail: { webinarId, eventType: "cta_click", data: { dedupeKey: "browser-test-only" } } }));
      window.dispatchEvent(new CustomEvent("livecast:webinar-registration", { detail: { webinarId, registrationId } }));
    }, { webinarId: fixture.webinarId, registrationId: fixture.registrationId });
    await expect(page.locator('script[data-livecast-tracking="gtm"]')).toHaveCount(0);
    expect(await page.evaluate(() => (window.dataLayer || []).filter(e => String(e.event).startsWith("webinar_")).length)).toBe(0);
    expect(network.some(r => r.host.includes("googletagmanager") || /collect/.test(r.path))).toBe(false);
    console.log(JSON.stringify({ case: "real-form-production-block", url: `${baseURL}/form/${fixture.webinarId}`,
      productionGtmScripts: 0, forwardedWebinarEvents: 0, collectAttempts: 0, network: summarize(network) }));
  });

  test("real room CTA click reaches dev referral endpoint and returns an opaque sc_ref redirect", async ({ page, baseURL }) => {
    const { network, redirects } = await protect(page.context(), baseURL!, fixture, "GTM-NVHG4XMR");
    const states = await page.request.get(`${baseURL}/api/webinars/${fixture.webinarId}/external-journey/public`);
    expect((await states.json()).approvedOrigins).toEqual(["https://noncodingai.com"]);
    await page.goto(`/webinar/${fixture.webinarId}?watchToken=${encodeURIComponent(fixture.watchToken)}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("input-nickname")).toBeVisible();
    await page.getByTestId("input-nickname").fill("Synthetic viewer");
    await page.getByTestId("button-join").click();
    const popupPromise = page.waitForEvent("popup");
    const cta = page.getByRole("link", { name: "TEST checkout CTA", exact: true });
    await cta.click();
    const popup = await popupPromise;
    await expect.poll(() => redirects.length).toBe(1);
    const destination = new URL(redirects[0]);
    expect(destination.pathname).toBe("/physical-classes/checkout/");
    expect(/^[A-Za-z0-9_-]{24,128}$/.test(destination.searchParams.get("sc_ref") || "")).toBe(true);
    expect(destination.searchParams.has("email") || destination.searchParams.has("phone") || destination.searchParams.has("watchToken")).toBe(false);
    const referrals = await fixture.referralEvidence();
    expect(referrals.length).toBe(1);
    expect(referrals[0]).toEqual({ is_test: true, registration_bound: true, owner_bound: true, target_matches: true });
    console.log(JSON.stringify({ case: "real-room-cta", url: `${baseURL}/webinar/${fixture.webinarId}`,
      destination: `${destination.origin}${destination.pathname}?sc_ref=<redacted>`, referral: referrals[0],
      redirectCapturedNotFollowed: true, network: summarize(network) }));
    await popup.close();
    await fixture.setOrigins([]);
    const unapprovedPopupPromise = page.waitForEvent("popup");
    await cta.click();
    const unapprovedPopup = await unapprovedPopupPromise;
    await expect.poll(() => unapprovedPopup.url().startsWith("https://noncodingai.com/physical-classes/checkout/")).toBe(true);
    expect(new URL(unapprovedPopup.url()).searchParams.has("sc_ref")).toBe(false);
    expect((await fixture.referralEvidence()).length).toBe(1);
    console.log(JSON.stringify({ case: "real-room-empty-dev-allowlist-control", approvedOrigins: [],
      hasScRef: false, additionalReferrals: 0, realDestinationRequestsAllowed: 0 }));
  });
});
