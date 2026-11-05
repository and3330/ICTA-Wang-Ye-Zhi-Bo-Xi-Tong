import { useEffect } from "react";
import {
  WEBINAR_TRACKING_EVENT,
  WEBINAR_REGISTRATION_EVENT,
  type WebinarEventType,
  type WebinarEventData,
} from "@/lib/webinar-tracking";
import { useMarketingConsent } from "@/components/marketing-consent";

export type TrackingWebinar = {
  metaPixelId?: string | null;
  gtmContainerId?: string | null;
};

export const isValidMetaPixelId = (value: string): boolean => /^\d{5,32}$/.test(value);
export const isValidGtmContainerId = (value: string): boolean => value.length >= 8 && value.length <= 24 && /^GTM-[A-Z0-9]+$/.test(value);
// The platform pixel is reserved for explicitly authorized platform
// conversions. A member webinar must never route its funnel events to it,
// even if an old webinar record contains the same numeric ID.
const RESERVED_PLATFORM_PIXEL_ID = "1096741902746313";

type Fbq = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void;
  queue?: unknown[][];
  loaded?: boolean;
  version?: string;
};

declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
    dataLayer?: Array<Record<string, unknown>>;
    __SELLCASE_PLATFORM_PIXEL_ID__?: string;
  }
}

// The platform pixel is initialized by the base code in index.html on every
// page; seed it here so it is never initialized twice.
const loadedPixels = new Set<string>(
  typeof window !== "undefined" && window.__SELLCASE_PLATFORM_PIXEL_ID__
    ? [window.__SELLCASE_PLATFORM_PIXEL_ID__]
    : [],
);
const loadedGtmContainers = new Set<string>();
const completedRegistrationEvents = new Set<string>();
const metaEventMap: Record<WebinarEventType, string> = {
  landing_view: "ViewContent",
  webinar_enter: "Lead",
  video_progress: "ViewContent",
  dropoff: "ViewContent",
  cta_view: "ViewContent",
  cta_click: "Contact",
  checkout_start: "InitiateCheckout",
};

// Automatic events are always off: every pixel (platform or member) must
// receive only explicitly scoped trackSingle events, so pixels that stay
// initialized across SPA navigation never pick up another tenant's clicks.
export function loadMetaPixel(id: string, automaticEvents = false) {
  if (!window.fbq) {
    const fbq: Fbq = function (...args: unknown[]) {
      if (fbq.callMethod) fbq.callMethod(...args);
      else (fbq.queue ||= []).push(args);
    };
    fbq.loaded = true;
    fbq.version = "2.0";
    window.fbq = window._fbq = fbq;
  }
  if (!window.fbq.callMethod && !document.querySelector('script[src*="connect.facebook.net"]')) {
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://connect.facebook.net/en_US/fbevents.js";
    script.dataset.livecastTracking = "meta";
    document.head.appendChild(script);
  }
  if (loadedPixels.has(id)) return;
  loadedPixels.add(id);
  if (!automaticEvents) window.fbq?.("set", "autoConfig", false, id);
  window.fbq?.("init", id);
}

function loadGtm(id: string) {
  if (loadedGtmContainers.has(id)) return;
  loadedGtmContainers.add(id);
  window.dataLayer ||= [];
  window.dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(id)}`;
  script.dataset.livecastTracking = "gtm";
  document.head.appendChild(script);
}

// Withdrawing consent stops member GTM containers and all member pixel
// events. The Meta SDK itself stays loaded because the platform pixel in
// index.html runs on every page regardless of consent, so the global
// fbq("consent", "revoke") switch cannot be used here.
export function revokeMarketingTracking() {
  window.dataLayer?.push({
    event: "sellcase_consent_update",
    ad_storage: "denied",
    analytics_storage: "denied",
  });
  document.querySelectorAll<HTMLScriptElement>('script[data-livecast-tracking="gtm"]').forEach((script) => script.remove());
  loadedGtmContainers.clear();
}

export function WebinarTrackingProvider({
  webinarId,
  metaPixelId,
  gtmContainerId,
}: TrackingWebinar & { webinarId?: string }) {
  const safePixelId = metaPixelId?.trim() || "";
  const safeGtmId = gtmContainerId?.trim().toUpperCase() || "";
  const marketingConsent = useMarketingConsent();
  const webinarPixelAllowed = isValidMetaPixelId(safePixelId) && safePixelId !== RESERVED_PLATFORM_PIXEL_ID;

  useEffect(() => {
    if (marketingConsent !== "granted") {
      revokeMarketingTracking();
      return;
    }
    if (webinarPixelAllowed) loadMetaPixel(safePixelId);
    if (isValidGtmContainerId(safeGtmId)) loadGtm(safeGtmId);
  }, [safePixelId, safeGtmId, webinarPixelAllowed, marketingConsent]);

  useEffect(() => {
    const completedRegistration = (event: Event) => {
      const detail = (event as CustomEvent<{ webinarId: string; registrationId: string }>).detail;
      if (!detail || detail.webinarId !== webinarId || marketingConsent !== "granted") return;
      const eventId = `registration_${detail.registrationId}`;
      const payload = { webinar_id: detail.webinarId, registration_id: detail.registrationId, event_id: eventId };
      if (webinarPixelAllowed) {
        const key = `meta:${safePixelId}:${eventId}`;
        if (!completedRegistrationEvents.has(key)) {
          completedRegistrationEvents.add(key);
          window.fbq?.("trackSingle", safePixelId, "CompleteRegistration", payload, { eventID: eventId });
        }
      }
      if (isValidGtmContainerId(safeGtmId)) {
        const key = `gtm:${safeGtmId}:${eventId}`;
        if (!completedRegistrationEvents.has(key)) {
          completedRegistrationEvents.add(key);
          window.dataLayer?.push({ event: "webinar_registration", ...payload });
        }
      }
    };
    window.addEventListener(WEBINAR_REGISTRATION_EVENT, completedRegistration);
    return () => window.removeEventListener(WEBINAR_REGISTRATION_EVENT, completedRegistration);
  }, [webinarId, safePixelId, safeGtmId, webinarPixelAllowed, marketingConsent]);

  useEffect(() => {
    const forward = (event: Event) => {
      const detail = (event as CustomEvent<{
        webinarId: string;
        eventType: WebinarEventType;
        data: WebinarEventData;
      }>).detail;
      if (!detail || detail.webinarId !== webinarId) return;
      const payload = {
        webinar_id: detail.webinarId,
        ...(detail.data.ctaId ? { cta_id: detail.data.ctaId } : {}),
        ...(detail.data.ctaKey ? { cta_key: detail.data.ctaKey } : {}),
        ...(detail.data.positionSeconds === undefined ? {} : { position_seconds: detail.data.positionSeconds }),
        ...detail.data.metadata,
      };
      if (marketingConsent === "granted" && webinarPixelAllowed) {
        window.fbq?.("trackSingle", safePixelId, metaEventMap[detail.eventType], payload);
      }
      if (marketingConsent === "granted" && isValidGtmContainerId(safeGtmId)) {
        window.dataLayer?.push({ event: `webinar_${detail.eventType}`, ...payload });
      }
    };
    window.addEventListener(WEBINAR_TRACKING_EVENT, forward);
    return () => window.removeEventListener(WEBINAR_TRACKING_EVENT, forward);
  }, [webinarId, safePixelId, safeGtmId, marketingConsent]);

  return null;
}