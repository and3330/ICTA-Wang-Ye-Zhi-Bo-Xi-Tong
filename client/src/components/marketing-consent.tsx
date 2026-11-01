import { readMarketingConsent } from "@/lib/marketing-consent";

/** Shared policy for existing pixel, GTM, and conversion callers. */
export function useMarketingConsent() {
  return readMarketingConsent();
}
