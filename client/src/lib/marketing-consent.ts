export const MARKETING_CONSENT_STORAGE_KEY = "sellcase.marketing-consent.v1";
export const MARKETING_CONSENT_EVENT = "sellcase:marketing-consent";

export type MarketingConsent = "granted" | "denied";

export function parseMarketingConsent(value: string | null): MarketingConsent | null {
  return value === "granted" || value === "denied" ? value : null;
}

export function readMarketingConsent(): MarketingConsent | null {
  if (typeof window === "undefined") return null;
  try {
    return parseMarketingConsent(window.localStorage.getItem(MARKETING_CONSENT_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function saveMarketingConsent(value: MarketingConsent) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MARKETING_CONSENT_STORAGE_KEY, value);
  } catch {
    // The in-memory event still updates this tab when storage is unavailable.
  }
  window.dispatchEvent(new CustomEvent<MarketingConsent>(MARKETING_CONSENT_EVENT, { detail: value }));
}