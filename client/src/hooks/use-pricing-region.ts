import { useQuery } from "@tanstack/react-query";

export type PricingRegion = {
  countryCode: string | null;
  displayCurrency: "TWD" | "USD";
  checkoutCurrency: "USD";
};

export const DEFAULT_PRICING_REGION: PricingRegion = {
  countryCode: null,
  displayCurrency: "USD",
  checkoutCurrency: "USD",
};

function normalizePricingRegion(value: unknown): PricingRegion {
  if (!value || typeof value !== "object") return DEFAULT_PRICING_REGION;

  const candidate = value as Partial<PricingRegion>;
  const countryCode = typeof candidate.countryCode === "string" && /^[A-Z]{2}$/.test(candidate.countryCode)
    ? candidate.countryCode
    : null;

  // TWD is only a presentation choice made by the server for Taiwan IPs.
  // Do not infer a visitor's country from language, timezone, or browser APIs.
  return {
    countryCode,
    displayCurrency: countryCode === "TW" && candidate.displayCurrency === "TWD" ? "TWD" : "USD",
    checkoutCurrency: "USD",
  };
}

/**
 * Resolve the visitor's display region once per browser session.
 *
 * The endpoint is IP-derived, so the request opts out of browser/proxy
 * caching. The query key is intentionally shared by the marketing and admin
 * surfaces, while the server response is private and never cacheable across
 * visitors.
 */
export function usePricingRegion() {
  return useQuery<PricingRegion>({
    queryKey: ["/api/pricing-region"],
    queryFn: async () => {
      const response = await fetch("/api/pricing-region", {
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error("無法判斷價格顯示地區");
      }
      return normalizePricingRegion(await response.json());
    },
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  });
}