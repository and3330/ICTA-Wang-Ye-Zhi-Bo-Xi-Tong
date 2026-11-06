import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { openTrackedExternalUrl, trackWebinarEvent } from "../client/src/lib/webinar-tracking";

function browserFixture(t: any) {
  const events: any[] = [], requests: any[] = [], navigations: string[] = [], alerts: string[] = [];
  const values = new Map<string, string>();
  const popup = { closed: false, opener: null, location: { replace: (url: string) => navigations.push(url) },
    close() { this.closed = true; } };
  const globals: Record<string, any> = {
    window: { location: { origin: "https://sellcase.example.test", search: "", assign: (url: string) => navigations.push(url) },
      dispatchEvent: (event: any) => events.push(event.detail), open: () => popup, confirm: () => false,
      alert: (message: string) => alerts.push(message) },
    localStorage: { getItem: (key: string) => values.get(key), setItem: (key: string, value: string) => values.set(key, value) },
    sessionStorage: { getItem: () => null },
    CustomEvent: class { detail: any; constructor(_type: string, init: any) { this.detail = init.detail; } },
    crypto: crypto.webcrypto,
  };
  for (const [key, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value, writable: true });
    t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : Reflect.deleteProperty(globalThis, key));
  }
  t.mock.method(globalThis, "fetch", async (url: string, init: any) => {
    requests.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    return new Response("{}", { status: 202 });
  });
  return { events, requests, navigations, alerts, popup };
}
test("each actual CTA click has a distinct event ID shared by browser forwarding and server receipt", t => {
  const fixture = browserFixture(t);
  const webinar = crypto.randomUUID(), ctaId = crypto.randomUUID();
  assert.equal(trackWebinarEvent(webinar, "cta_click", { ctaId }), true);
  assert.equal(trackWebinarEvent(webinar, "cta_click", { ctaId }), true);
  assert.equal(fixture.requests.length, 2);
  assert.notEqual(fixture.requests[0].body.dedupeKey, fixture.requests[1].body.dedupeKey);
  fixture.events.forEach((event, i) => assert.equal(event.data.dedupeKey, fixture.requests[i].body.dedupeKey));
  assert.ok(fixture.requests.every(request => request.url.startsWith("/api/")), "no real advertising or third-party requests");
});
test("opted-in external CTA cannot silently open an untracked URL when token creation fails", async t => {
  const fixture = browserFixture(t);
  t.mock.method(globalThis, "fetch", async (url: string) => url.includes("external-journey/public")
    ? Response.json({ approvedOrigins: ["https://merchant.example.test"] })
    : Response.json({ message: "Fixture unavailable" }, { status: 503 }));
  await openTrackedExternalUrl(crypto.randomUUID(), "https://merchant.example.test/buy", { ctaId: crypto.randomUUID() });
  assert.deepEqual(fixture.navigations, []);
  assert.equal(fixture.popup.closed, true);
  assert.equal(fixture.alerts.length, 1);
});
test("successful tracked CTA uses only the server-issued opaque redirect", async t => {
  const fixture = browserFixture(t);
  t.mock.method(globalThis, "fetch", async (url: string) => url.includes("external-journey/public")
    ? Response.json({ approvedOrigins: ["https://merchant.example.test"] })
    : Response.json({ redirectUrl: "/r/fixture-opaque-attribution" }));
  await openTrackedExternalUrl(crypto.randomUUID(), "https://merchant.example.test/buy", { ctaId: crypto.randomUUID() });
  assert.deepEqual(fixture.navigations, ["https://sellcase.example.test/r/fixture-opaque-attribution"]);
  assert.ok(!fixture.navigations[0].includes("email") && !fixture.navigations[0].includes("watchToken"));
});
