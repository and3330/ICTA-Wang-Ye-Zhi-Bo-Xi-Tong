import test from "node:test";
import assert from "node:assert/strict";
import { loadGtm, canForwardGtmEvents, clearLoadedGtmContainers,
  isNonProductionTrackingEnvironment, PRODUCTION_GTM_CONTAINERS } from "../client/src/lib/gtm-runtime";

function fixture(t: any, hostname: string) {
  const scripts: any[] = [];
  const win: any = { location: { hostname, href: `https://${hostname}/oauth/test` } };
  const doc = {
    querySelectorAll: () => scripts,
    createElement: () => ({ dataset: {} }),
    head: { appendChild: (script: any) => scripts.push(script) },
  };
  for (const [key, value] of Object.entries({ window: win, document: doc })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : Reflect.deleteProperty(globalThis, key));
  }
  clearLoadedGtmContainers();
  t.after(clearLoadedGtmContainers);
  return { scripts, win };
}
test("development/preview/test modes and replit.dev hosts cannot be treated as production", () => {
  for (const environment of [
    { hostname: "icta-webinar.com", mode: "development" },
    { hostname: "icta-webinar.com", mode: "preview" },
    { hostname: "icta-webinar.com", mode: "test" },
    { hostname: "icta-webinar.com", dev: true },
    { hostname: "fixture.replit.dev", mode: "production" },
    { hostname: "localhost", mode: "production" },
  ]) assert.equal(isNonProductionTrackingEnvironment(environment), true);
  assert.equal(isNonProductionTrackingEnvironment({ hostname: "icta-webinar.com", mode: "production", dev: false }), false);
  assert.equal(Object.isFrozen(PRODUCTION_GTM_CONTAINERS), true);
});
test("loadGtm blocks the production container and its dataLayer initialization in preview", t => {
  const { scripts, win } = fixture(t, "fixture.replit.dev");
  assert.equal(loadGtm("GTM-NVHG4XMR"), false);
  assert.equal(loadGtm("GTM-NVHG4XMR"), false);
  assert.equal(canForwardGtmEvents("GTM-NVHG4XMR"), false);
  assert.equal(scripts.length, 0);
  assert.equal(win.dataLayer, undefined);
});
test("preview permits a non-production container exactly once", t => {
  const { scripts, win } = fixture(t, "fixture.replit.dev");
  assert.equal(loadGtm("GTM-DEVTEST1"), true);
  assert.equal(loadGtm("GTM-DEVTEST1"), true);
  assert.equal(scripts.length, 1);
  assert.equal(win.dataLayer.length, 1);
});
test("preview suppresses shared dataLayer forwarding if a protected container was injected elsewhere", t => {
  const { scripts, win } = fixture(t, "fixture.replit.dev");
  scripts.push({ src: "https://www.googletagmanager.com/gtm.js?id=GTM-NVHG4XMR" });
  assert.equal(canForwardGtmEvents("GTM-DEVTEST1"), false);
  scripts.length = 0;
  win.google_tag_manager = { "GTM-NVHG4XMR": {} };
  assert.equal(canForwardGtmEvents("GTM-DEVTEST1"), false);
});
test("production retains loading and Set deduplication for the production container without network calls", t => {
  const { scripts, win } = fixture(t, "icta-webinar.com");
  assert.equal(loadGtm("GTM-NVHG4XMR"), true);
  assert.equal(loadGtm("GTM-NVHG4XMR"), true);
  assert.equal(scripts.length, 1);
  assert.equal(win.dataLayer.length, 1);
  assert.equal(canForwardGtmEvents("GTM-NVHG4XMR"), true);
});
