import { test, expect } from "@playwright/test";

test("development preview blocks production GTM scripts and webinar forwarding with zero tracking egress", async ({ page, baseURL }) => {
  if (!baseURL || !/replit\.dev|127\.0\.0\.1|localhost/.test(new URL(baseURL).hostname)) {
    throw new Error("This evidence test may only target development/preview");
  }
  const host = new URL(baseURL).hostname;
  const attempts: string[] = [];
  let forwardedThirdParty = 0;
  // Install before navigation: no Google, Meta, authentication or other
  // third-party requests are ever allowed out of this browser fixture.
  await page.context().route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== host) {
      attempts.push(`${url.hostname}${url.pathname}`);
      await route.abort();
      return;
    }
    if (url.pathname === "/oauth/gtm-isolation-evidence") {
      await route.fulfill({ contentType: "text/html", body: `<!doctype html><html><head><title>GTM development isolation evidence</title></head>
        <body><h1>GTM development isolation test</h1><div id="fixture"></div>
        <script type="module">
          import RefreshRuntime from '/@react-refresh';
          RefreshRuntime.injectIntoGlobalHook(window);
          window.$RefreshReg$ = () => {};
          window.$RefreshSig$ = () => type => type;
          window.__vite_plugin_react_preamble_installed__ = true;
        </script></body></html>` });
      return;
    }
    // This harness never needs application API data or registrations.
    if (url.pathname.startsWith("/api/")) throw new Error("Unexpected API request from tracking-only fixture");
    await route.continue();
  });
  await page.goto("/oauth/gtm-isolation-evidence");
  await page.waitForFunction(() => (window as any).__vite_plugin_react_preamble_installed__ === true);
  await page.evaluate(async () => {
    const runtimeImport = (url: string) => import(/* @vite-ignore */ url);
    // Vite's root is client/, so optimized dependencies can be served through
    // /@fs/ rather than /node_modules/. Resolve its actual versioned import.
    const providerSource = await (await fetch("/src/components/webinar-tracking-provider.tsx")).text();
    const reactUrl = providerSource.match(/from\s+["']([^"']*\/react\.js(?:\?[^"']*)?)["']/)?.[1];
    if (!reactUrl) throw new Error("Cannot resolve the development server's React import");
    const reactModule = await runtimeImport(reactUrl);
    const React = reactModule.default ?? reactModule;
    const domModule = await runtimeImport(reactUrl.replace(/\/react\.js(?=\?|$)/, "/react-dom_client.js"));
    const { createRoot } = domModule.default ?? domModule;
    const { WebinarTrackingProvider, loadGtm } = await runtimeImport("/src/components/webinar-tracking-provider.tsx");
    function ReadyProbe() {
      React.useEffect(() => { (window as any).__gtmEvidenceReady = true; }, []);
      return null;
    }
    createRoot(document.getElementById("fixture")).render(React.createElement(React.Fragment, null,
      React.createElement(WebinarTrackingProvider, {
        webinarId: "11111111-1111-4111-8111-111111111111", gtmContainerId: "GTM-NVHG4XMR",
      }), React.createElement(ReadyProbe)));
    (window as any).__gtmEvidenceLoadResults = [loadGtm("GTM-NVHG4XMR"), loadGtm("GTM-NVHG4XMR")];
  });
  // Confirm React effects subscribed before exercising both forwarding paths.
  await page.waitForFunction(() => (window as any).__gtmEvidenceReady === true);
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("livecast:webinar-event", { detail: {
      webinarId: "11111111-1111-4111-8111-111111111111", eventType: "cta_click",
      data: { dedupeKey: "fixture-click-only", ctaId: "22222222-2222-4222-8222-222222222222" },
    } }));
    window.dispatchEvent(new CustomEvent("livecast:webinar-registration", { detail: {
      webinarId: "11111111-1111-4111-8111-111111111111", registrationId: "33333333-3333-4333-8333-333333333333",
    } }));
  });
  await page.waitForTimeout(250);
  const evidence = await page.evaluate(() => ({
    loadResults: (window as any).__gtmEvidenceLoadResults,
    protectedScriptCount: Array.from(document.scripts).filter(s => s.src.includes("GTM-NVHG4XMR")).length,
    forwardedWebinarEvents: (window.dataLayer || []).filter(e => String(e.event || "").startsWith("webinar_")).length,
  }));
  expect(evidence.loadResults).toEqual([false, false]);
  expect(evidence.protectedScriptCount).toBe(0);
  expect(evidence.forwardedWebinarEvents).toBe(0);
  const trackingAttempts = attempts.filter(url => /googletagmanager|google-analytics|\/collect|facebook\.com|connect\.facebook/.test(url));
  expect(trackingAttempts).toEqual([]);
  expect(forwardedThirdParty).toBe(0);
  console.log(JSON.stringify({ evidence: "development-preview-network-interception", ...evidence,
    trackingRequestAttempts: trackingAttempts.length, thirdPartyRequestsAllowed: forwardedThirdParty }));
});
