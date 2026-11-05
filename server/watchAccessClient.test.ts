import assert from "node:assert/strict";
import test from "node:test";
import { getWatchToken, getStoredWatchState, saveWatchAccess, watchUrl } from "../client/src/lib/watch-access";

function browser(t: any, search: string, denied: boolean) {
  const originals = ["window", "sessionStorage"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { search, origin: "https://example.test" } } });
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    get() {
      if (denied) throw new DOMException("Storage blocked", "SecurityError");
      return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) };
    },
  });
  t.after(() => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
}

test("URL watch credentials work even when mobile browser storage is denied", t => {
  browser(t, "?watchToken=test-only-not-a-valid-token", true);
  assert.equal(getWatchToken("test-webinar"), "test-only-not-a-valid-token");
  assert.doesNotThrow(() => saveWatchAccess("test-webinar", { watchToken: "test-only-not-a-valid-token" }));
  assert.equal(getStoredWatchState("test-webinar"), null);
});

test("missing credentials and denied storage return null without granting access", t => {
  browser(t, "", true);
  assert.equal(getWatchToken("test-webinar"), null);
});

test("storage remains a working fallback and explicit viewer URLs carry the new token", t => {
  browser(t, "", false);
  saveWatchAccess("test-webinar", { watchToken: "test-only-not-a-valid-token", watchState: { canWatch: true } });
  assert.equal(getWatchToken("test-webinar"), "test-only-not-a-valid-token");
  assert.equal(getStoredWatchState("test-webinar")?.canWatch, true);
  const url = new URL(watchUrl("/webinar/test-webinar", "test-webinar", "new-test-only-token"));
  assert.equal(url.origin, "https://example.test");
  assert.equal(url.searchParams.get("watchToken"), "new-test-only-token");
});
