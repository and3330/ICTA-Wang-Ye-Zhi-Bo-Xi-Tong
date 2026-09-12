import type { Express } from "express";
import { isIP } from "node:net";

type CountryLookup = (ip: string) => { country: string } | null;
let lookupPromise: Promise<CountryLookup> | undefined;

async function localLookup(): Promise<CountryLookup> {
  // Load the bundled database only on demand, not before the startup probe.
  lookupPromise ??= import("geoip-lite").then(module => module.default.lookup);
  return lookupPromise;
}

export async function resolvePricingRegion(ip: string | undefined) {
  const normalizedIp = ip?.trim().replace(/^::ffff:/i, "");
  const match = normalizedIp && isIP(normalizedIp)
    ? (await localLookup())(normalizedIp)
    : null;
  const countryCode = match?.country && /^[A-Z]{2}$/.test(match.country)
    ? match.country
    : null;
  return {
    countryCode,
    displayCurrency: countryCode === "TW" ? "TWD" as const : "USD" as const,
    checkoutCurrency: "USD" as const,
  };
}

export function registerPricingRegionRoutes(app: Express) {
  app.get("/api/pricing-region", async (req, res) => {
    // IP-derived responses must never leak between visitors through a cache.
    res.setHeader("Cache-Control", "private, no-store");
    try {
      // index.ts trusts one Replit proxy hop. Do not read the first XFF entry,
      // country headers, language, query parameters, or browser time zone.
      res.json(await resolvePricingRegion(req.ip));
    } catch {
      res.status(503).json({
        message: "暫時無法判斷價格顯示地區，請以美元售價為準。",
        countryCode: null,
        displayCurrency: "USD",
        checkoutCurrency: "USD",
      });
    }
  });
}