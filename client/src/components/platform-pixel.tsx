import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { loadMetaPixel, revokeMarketingTracking } from "@/components/webinar-tracking-provider";
import { useMarketingConsent } from "@/components/marketing-consent";
import { clearPlatformConversionsPending } from "@/lib/platform-conversions";

const PLATFORM_PIXEL_ID = "1096741902746313";

/**
 * The platform pixel base code lives in index.html and already sends the
 * first PageView for every full page load. This component only reports
 * client-side route changes so each SPA page counts as a page view too.
 *
 * Events stay pixel-scoped (`trackSingle`) and automatic events are disabled,
 * so member webinar pixels loaded later never receive platform traffic and
 * vice versa.
 */
export function PlatformPixel() {
  const [path] = useLocation();
  const consent = useMarketingConsent();
  const lastPage = useRef<string | null>(
    typeof window !== "undefined" ? window.location.pathname : null,
  );

  useEffect(() => {
    if (path.startsWith("/oauth/") || path === "/admin/settings/authorized-apps") return;
    if (lastPage.current === path) return;
    loadMetaPixel(PLATFORM_PIXEL_ID, false);
    window.fbq?.("trackSingle", PLATFORM_PIXEL_ID, "PageView");
    lastPage.current = path;
  }, [path]);

  // This component is always mounted, so it is the reliable place to act on
  // consent withdrawal even after the visitor has left a member page:
  // member GTM stops and queued platform conversions are discarded. Member
  // pixel events are gated per call and automatic events are disabled.
  useEffect(() => {
    if (consent !== "denied") return;
    clearPlatformConversionsPending();
    revokeMarketingTracking();
  }, [consent]);

  return null;
}
