import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createServer } from "node:http";
import { registerPricingRegionRoutes, resolvePricingRegion } from "./pricingRegion";

test("local IP lookup selects Taiwan references but always USD checkout", async () => {
  assert.deepEqual(await resolvePricingRegion("168.95.1.1"), {
    countryCode: "TW", displayCurrency: "TWD", checkoutCurrency: "USD",
  });
  assert.equal((await resolvePricingRegion("::ffff:168.95.1.1")).displayCurrency, "TWD");
  assert.equal((await resolvePricingRegion("8.8.8.8")).displayCurrency, "USD");
  assert.equal((await resolvePricingRegion("2001:b000::1")).displayCurrency, "TWD");
  for (const ip of [undefined, "", "invalid", "127.0.0.1", "::1", "10.0.0.1"]) {
    assert.deepEqual(await resolvePricingRegion(ip), {
      countryCode: null, displayCurrency: "USD", checkoutCurrency: "USD",
    });
  }
});

test("one-hop proxy ignores spoofed leftmost IP and country overrides, without shared caching", async t => {
  const app = express();
  app.set("trust proxy", 1);
  registerPricingRegionRoutes(app);
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address() as { port: number };
  const url = `http://127.0.0.1:${address.port}/api/pricing-region?country=TW`;
  const us = await fetch(url, {
    headers: { "X-Forwarded-For": "168.95.1.1, 8.8.8.8", "CF-IPCountry": "TW" },
  });
  assert.equal(us.headers.get("cache-control"), "private, no-store");
  assert.equal((await us.json()).displayCurrency, "USD");
  const tw = await fetch(url, { headers: { "X-Forwarded-For": "168.95.1.1" } });
  assert.deepEqual(await tw.json(), {
    countryCode: "TW", displayCurrency: "TWD", checkoutCurrency: "USD",
  });
  const unknown = await fetch(url, { headers: { "CF-IPCountry": "TW", "Accept-Language": "zh-TW" } });
  assert.equal((await unknown.json()).displayCurrency, "USD");
});