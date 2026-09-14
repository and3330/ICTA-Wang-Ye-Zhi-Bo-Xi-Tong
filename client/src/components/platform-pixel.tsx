import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useMarketingConsent } from "@/components/marketing-consent";
import { loadMetaPixel, revokeMarketingTracking } from "@/components/webinar-tracking-provider";
import { clearPlatformConversionsPending } from "@/lib/platform-conversions";

const PLATFORM_PIXEL_ID = "1096741902746313";

// Deliberately opt in only platform marketing routes. New routes stay excluded.
const isMarketingPage = (path: string) =>
  path === "/" || /^\/(?:features|solutions)(?:\/[^/]+)?\/?$/.test(path);

export function PlatformPixel() {
  const [path] = useLocation();
  const consent = useMarketingConsent();
  const lastPage = useRef<string | null>(null);

  useEffect(() => {
    if (consent !== "granted") {
      lastPage.current = null;
      if (consent === "denied") clearPlatformConversionsPending();
      revokeMarketingTracking();
      return;
    }
    if (!isMarketingPage(path)) {
      lastPage.current = null;
      return;
    }
    // No automatic events: the SDK can remain loaded during SPA navigation to
    // a member page, but this pixel must receive only explicitly scoped events.
    loadMetaPixel(PLATFORM_PIXEL_ID, false);
    window.fbq?.("consent", "grant");
    if (lastPage.current !== path) {
      window.fbq?.("trackSingle", PLATFORM_PIXEL_ID, "PageView");
      lastPage.current = path;
    }
  }, [path, consent]);

  return null;
}