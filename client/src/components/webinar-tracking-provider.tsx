import { useEffect } from "react";
import {
  WEBINAR_TRACKING_EVENT,
  type WebinarEventType,
  type WebinarEventData,
} from "@/lib/webinar-tracking";
import { useMarketingConsent } from "@/components/marketing-consent";

export type TrackingWebinar = {
  metaPixelId?: string | null;
  gtmContainerId?: string | null;
};

export const isValidMetaPixelId = (value: string): boolean => /^\d+$/.test(value);
export const isValidGtmContainerId = (value: string): boolean => /^GTM-[A-Z0-9]+$/.test(value);

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
  }
}

const loadedPixels = new Set<string>();
const loadedGtmContainers = new Set<string>();
const metaEventMap: Record<WebinarEventType, string> = {
  landing_view: "ViewContent",
  webinar_enter: "Lead",
  video_progress: "ViewContent",
  dropoff: "ViewContent",
  cta_view: "ViewContent",
  cta_click: "Contact",
  checkout_start: "InitiateCheckout",
};

function loadMetaPixel(id: string) {
  if (loadedPixels.has(id)) return;
  loadedPixels.add(id);
  if (!window.fbq) {
    const fbq: Fbq = function (...args: unknown[]) {
      if (fbq.callMethod) fbq.callMethod(...args);
      else (fbq.queue ||= []).push(args);
    };
    fbq.loaded = true;
    fbq.version = "2.0";
    window.fbq = window._fbq = fbq;
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://connect.facebook.net/en_US/fbevents.js";
    script.dataset.livecastTracking = "meta";
    document.head.appendChild(script);
  }
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

function revokeMarketingTracking() {
  window.fbq?.("consent", "revoke");
  window.dataLayer?.push({
    event: "sellcase_consent_update",
    ad_storage: "denied",
    analytics_storage: "denied",
  });
  document.querySelectorAll<HTMLScriptElement>("script[data-livecast-tracking]").forEach((script) => script.remove());
  loadedPixels.clear();
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

  useEffect(() => {
    if (marketingConsent !== "granted") {
      revokeMarketingTracking();
      return;
    }
    if (isValidMetaPixelId(safePixelId)) loadMetaPixel(safePixelId);
    if (isValidGtmContainerId(safeGtmId)) loadGtm(safeGtmId);
    window.fbq?.("consent", "grant");
  }, [safePixelId, safeGtmId, marketingConsent]);

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
      if (marketingConsent === "granted" && isValidMetaPixelId(safePixelId)) {
        window.fbq?.("track", metaEventMap[detail.eventType], payload);
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