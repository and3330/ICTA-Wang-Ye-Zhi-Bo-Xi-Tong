export type MarketingConsent = "granted" | "denied";

/** Site-wide tracking policy: enabled without a consent dialog or storage dependency. */
export function readMarketingConsent(): MarketingConsent {
  return "granted";
}