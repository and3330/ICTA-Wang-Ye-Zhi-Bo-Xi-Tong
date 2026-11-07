import { test, expect, type BrowserContext } from "@playwright/test";
import crypto from "node:crypto";
import { pool } from "../server/db";
import { createRetainedAcceptanceWebinar } from "../server/acceptanceRetainedFixture";
import { createWatchToken } from "../server/watchTokens";

test.use({ trace: "off", video: "off", screenshot: "off", serviceWorkers: "block" });
type Evidence = { host: string; path: string; action: string; count?: number };

// Every HTTP request is fulfilled/aborted or fetched with maxRedirects:0.
// No route.continue: a same-origin redirect cannot escape to a formal domain.
async function protect(context: BrowserContext, baseURL: string, webinarId: string) {
  const host = new URL(baseURL).hostname;
  const clerkDevelopmentHost = "funky-fawn-7448.clerk.accounts.dev";
  expect(host.startsWith("9fdababe-8652-4086-97a8-8c9b80d2191b-")).toBe(true);
  const records: Evidence[] = [];
  let allowedFormalRequests = 0;
  await context.routeWebSocket("**", socket => socket.close());
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    const record = (action: string) => records.push({ host: url.hostname,
      path: url.pathname.startsWith("/r/") ? "/r/<redacted>" : url.pathname, action });
    if (url.hostname === "www.googletagmanager.com" && url.pathname === "/gtm.js"
      && url.searchParams.get("id") === "GTM-DEVTEST1") {
      record("local-inert-stub-no-egress");
      return route.fulfill({ contentType: "application/javascript", body: "/* inert acceptance stub */" });
    }
    if (url.hostname === "player.vimeo.com") {
      record("local-media-stub-no-egress");
      if (url.pathname === "/api/player.js") return route.fulfill({
        contentType: "application/javascript", body: `window.Vimeo={Player:class{
          constructor(){this.handlers={};} on(n,f){this.handlers[n]=f;} off(n){delete this.handlers[n];}
          ready(){return Promise.resolve();} getDuration(){return Promise.resolve(3600);}
          getCurrentTime(){return Promise.resolve(0);} getPaused(){return Promise.resolve(true);}
          getMuted(){return Promise.resolve(true);} getVolume(){return Promise.resolve(0);}
          setVolume(){return Promise.resolve();} setMuted(){return Promise.resolve();}
          setCurrentTime(){return Promise.resolve(0);} play(){return Promise.resolve();}
          pause(){return Promise.resolve();} destroy(){return Promise.resolve();}
        }};`,
      });
      return route.fulfill({ contentType: "text/html", body: "<main>local video fixture</main>" });
    }
    const devClerk = url.hostname === clerkDevelopmentHost;
    if (url.hostname !== host && !devClerk) {
      record("blocked-before-send");
      return route.abort();
    }
    if (url.hostname === host && route.request().method() !== "GET") {
      record("test-write-intercepted-no-jobs");
      return route.fulfill({ json: { ok: true } });
    }
    // Do not follow ANY redirects, including auth SDK asset redirects.
    if (url.hostname !== host && !devClerk) allowedFormalRequests++;
    let response = await route.fetch({ maxRedirects: 0, maxRetries: 0 });
    // 304 is cache validation, not navigation. Follow only verified DEV-host
    // navigation redirects explicitly; never delegate redirect following.
    for (let hop = 0; [301, 302, 303, 307, 308].includes(response.status()); hop++) {
      record("redirect-captured-not-followed");
      const location = response.headers().location;
      const destination = location ? new URL(location, response.url()) : null;
      console.log(JSON.stringify({ safety: "redirect-inspected-before-follow",
        fromHost: url.hostname, fromPath: url.pathname, status: response.status(),
        destinationHost: destination?.hostname, destinationPath: destination?.pathname,
        formalDestinationFollowed: false }));
      const allowedDestination = destination &&
        [host, clerkDevelopmentHost].includes(destination.hostname);
      if (!allowedDestination || hop >= 3) {
        return route.fulfill({ status: 200, contentType: "text/plain", body: "Redirect stopped by acceptance guard" });
      }
      response = await route.fetch({ url: destination.toString(), maxRedirects: 0, maxRetries: 0 });
    }
    if (url.hostname === host && url.pathname === `/api/webinars/${webinarId}`) {
      const webinar = await response.json();
      // Browser-only tracking branch override; persisted DB remains test=true.
      return route.fulfill({ response, json: { ...webinar, isTest: false, metaPixelId: null,
        gtmContainerId: "GTM-DEVTEST1" } });
    }
    return route.fulfill({ response });
  });
  return {
    records,
    allowedFormalRequests: () => allowedFormalRequests,
    summarize: () => {
      const counts = new Map<string, Evidence>();
      for (const r of records) {
        const key = `${r.host}|${r.path}|${r.action}`;
        const old = counts.get(key);
        counts.set(key, { ...r, count: (old?.count || 0) + 1 });
      }
      return [...counts.values()];
    },
  };
}

test("R2 real DEV room: one safe stub initialization and zero formal tracking egress", async ({ page, baseURL }) => {
  const fixture = await createRetainedAcceptanceWebinar("room");
  const registrationId = crypto.randomUUID();
  await pool.query(
    "INSERT INTO registrations(id,webinar_id,name,email,is_test) VALUES($1,$2,$3,$4,true)",
    [registrationId, fixture.webinarId, "TEST retained R2 viewer", "retained-r2@example.test"],
  );
  const guard = await protect(page.context(), baseURL!, fixture.webinarId);
  const watch = createWatchToken(registrationId, fixture.webinarId, Date.now() + 10 * 60_000);
  await page.goto(`/webinar/${fixture.webinarId}?watchToken=${encodeURIComponent(watch)}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("input-nickname")).toBeVisible();
  await page.getByTestId("input-nickname").fill("TEST retained viewer");
  await page.getByTestId("button-join").click();
  await expect(page.getByTestId("input-chat-message")).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(`/webinar/${fixture.webinarId}`);
  await expect(page.locator('script[data-livecast-tracking="gtm"]')).toHaveCount(1);
  await page.evaluate(async () => {
    const path = "/src/lib/gtm-runtime.ts";
    const { loadGtm } = await import(/* @vite-ignore */ path);
    loadGtm("GTM-DEVTEST1"); loadGtm("GTM-DEVTEST1");
    loadGtm("GTM-NVHG4XMR");
  });
  const evidence = await page.evaluate(() => ({
    stubScripts: document.querySelectorAll('script[data-livecast-tracking="gtm"]').length,
    gtmStarts: (window.dataLayer || []).filter(x => x.event === "gtm.js").length,
    productionScripts: [...document.scripts].filter(x => x.src.includes("GTM-NVHG4XMR")).length,
  }));
  expect(evidence).toEqual({ stubScripts: 1, gtmStarts: 1, productionScripts: 0 });
  expect(guard.records.filter(r => r.host === "www.googletagmanager.com" && r.path === "/gtm.js")).toHaveLength(1);
  expect(guard.records.some(r => /collect/.test(r.path))).toBe(false);
  expect(guard.allowedFormalRequests()).toBe(0);
  const { rows: [persisted] } = await pool.query(
    "SELECT is_test FROM webinars WHERE id=$1", [fixture.webinarId],
  );
  expect(persisted.is_test).toBe(true);
  console.log(JSON.stringify({ case: "R2-real-room", url: `${baseURL}/webinar/${fixture.webinarId}`,
    joinedRealRoom: true, ...evidence, formalTrackingRequestsSent: guard.allowedFormalRequests(),
    serviceWorkers: "blocked", websocket: "closed-before-connect", redirectPolicy: "manual-dev-and-exact-dev-clerk-only-no-formal-follow",
    databaseIsTest: true, fixtureRetained: true, noCtaClick: true, network: guard.summarize() }));
});

test.afterAll(async () => { await pool.end(); }); // Handles only; retain all data.
