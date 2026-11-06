import { readMarketingConsent } from "./marketing-consent";

// Public container identifiers, not credentials. Do not make this denylist
// writable through webinar settings or a browser-supplied environment override.
export const PRODUCTION_GTM_CONTAINERS = Object.freeze(["GTM-NVHG4XMR"] as const);
const loadedGtmContainers = new Set<string>();
export const isValidGtmContainerId = (id: string) =>
  id.length >= 8 && id.length <= 24 && /^GTM-[A-Z0-9]+$/.test(id);

export function isNonProductionTrackingEnvironment(environment: {
  hostname: string; mode?: string; dev?: boolean;
}) {
  const hostname = environment.hostname.toLowerCase();
  return environment.dev === true
    || (environment.mode !== undefined && environment.mode !== "production")
    || hostname === "replit.dev" || hostname.endsWith(".replit.dev")
    || hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function nonProduction() {
  return isNonProductionTrackingEnvironment({
    hostname: window.location.hostname,
    mode: import.meta.env?.MODE,
    dev: import.meta.env?.DEV,
  });
}

function protectedContainerAlreadyPresent() {
  const registry = (window as Window & { google_tag_manager?: Record<string, unknown> }).google_tag_manager;
  if (PRODUCTION_GTM_CONTAINERS.some(id => registry?.[id])) return true;
  return Array.from(document.querySelectorAll<HTMLScriptElement>('script[src*="googletagmanager.com"]')).some(script => {
    try {
      const id = new URL(script.src, window.location.href).searchParams.get("id");
      return PRODUCTION_GTM_CONTAINERS.some(protectedId => protectedId === id);
    } catch { return false; }
  });
}

/** dataLayer is global: also suppress forwarding if another integration has
 * already inserted a protected container in a non-production page. */
export function canForwardGtmEvents(id: string) {
  if (!isValidGtmContainerId(id)) return false;
  if (!nonProduction()) return true;
  return !PRODUCTION_GTM_CONTAINERS.some(protectedId => protectedId === id)
    && !protectedContainerAlreadyPresent();
}

export function loadGtm(id: string) {
  if (readMarketingConsent() !== "granted" || !canForwardGtmEvents(id)) return false;
  if (loadedGtmContainers.has(id)) return true;
  loadedGtmContainers.add(id);
  window.dataLayer ||= [];
  window.dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(id)}`;
  script.dataset.livecastTracking = "gtm";
  document.head.appendChild(script);
  return true;
}

export function clearLoadedGtmContainers() { loadedGtmContainers.clear(); }
