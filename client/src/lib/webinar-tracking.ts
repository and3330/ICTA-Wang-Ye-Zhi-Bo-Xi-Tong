import { getWatchToken } from "./watch-access";
export const WEBINAR_EVENT_TYPES = [
  "landing_view",
  "webinar_enter",
  "video_progress",
  "dropoff",
  "cta_view",
  "cta_click",
  "checkout_start",
] as const;

export type WebinarEventType = (typeof WEBINAR_EVENT_TYPES)[number];
export type WebinarEventMetadata = {
  source?: string;
  medium?: string;
  campaign?: string;
  term?: string;
  content?: string;
  reason?: "pause" | "navigate" | "close" | "ended" | "unknown";
  progressPercent?: number;
};
export type WebinarEventData = {
  ctaId?: string;
  ctaKey?: string;
  positionSeconds?: number;
  metadata?: WebinarEventMetadata;
};

export const WEBINAR_TRACKING_EVENT = "livecast:webinar-event";

const sentEvents = new Set<string>();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VISITOR_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const CTA_KEY_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

export const isUuid = (value: string | undefined): value is string =>
  typeof value === "string" && UUID_PATTERN.test(value);
export const isCtaKey = (value: string | undefined): value is string =>
  typeof value === "string" && CTA_KEY_PATTERN.test(value);

function createVisitorToken(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `anon_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
}

export function getWebinarVisitorToken(webinarId: string): string {
  const key = `livecast_visitor_${webinarId}`;
  try {
    const stored = localStorage.getItem(key);
    if (stored && VISITOR_TOKEN_PATTERN.test(stored)) return stored;
    const token = createVisitorToken();
    localStorage.setItem(key, token);
    return token;
  } catch {
    return createVisitorToken();
  }
}

function boundedMetadata(metadata: WebinarEventMetadata | undefined): WebinarEventMetadata {
  const result: WebinarEventMetadata = {};
  const addText = (key: "source" | "medium" | "campaign" | "term" | "content", value?: string) => {
    const clean = value?.trim().slice(0, 100);
    if (clean) result[key] = clean;
  };
  addText("source", metadata?.source);
  addText("medium", metadata?.medium);
  addText("campaign", metadata?.campaign);
  addText("term", metadata?.term);
  addText("content", metadata?.content);
  if (metadata?.reason) result.reason = metadata.reason;
  if (typeof metadata?.progressPercent === "number" && Number.isFinite(metadata.progressPercent)) {
    result.progressPercent = Math.max(0, Math.min(100, metadata.progressPercent));
  }
  return result;
}

function eventSuffix(eventType: WebinarEventType, data: WebinarEventData): string {
  if (eventType === "video_progress") return `p${Math.round(data.metadata?.progressPercent || 0)}`;
  if (eventType === "dropoff") return `s${Math.max(0, Math.floor(data.positionSeconds || 0))}`;
  if (isUuid(data.ctaId)) return data.ctaId;
  if (isCtaKey(data.ctaKey)) return data.ctaKey;
  return "once";
}

export function trackWebinarEvent(
  webinarId: string | undefined,
  eventType: WebinarEventType,
  data: WebinarEventData = {},
  options: { beacon?: boolean } = {},
): boolean {
  if (!webinarId || typeof window === "undefined") return false;
  if ((eventType === "cta_view" || eventType === "cta_click") && !isUuid(data.ctaId) && !isCtaKey(data.ctaKey)) return false;
  if ((eventType === "video_progress" || eventType === "dropoff") && data.positionSeconds === undefined) return false;

  const visitorToken = getWebinarVisitorToken(webinarId);
  const dedupeKey = `${visitorToken}.${eventType}.${eventSuffix(eventType, data)}`.slice(0, 128);
  const memoryKey = `${webinarId}:${dedupeKey}`;
  if (sentEvents.has(memoryKey)) return false;
  sentEvents.add(memoryKey);

  const metadata = boundedMetadata(data.metadata);
  let watchToken: string | null = null;
  try {
    watchToken = getWatchToken(webinarId);
  } catch {
    // Storage can be blocked; the event is still counted anonymously.
  }
  const payload = {
    eventType,
    dedupeKey,
    visitorToken,
    ...(watchToken ? { watchToken } : {}),
    ...(isUuid(data.ctaId) ? { ctaId: data.ctaId } : {}),
    ...(!isUuid(data.ctaId) && isCtaKey(data.ctaKey) ? { ctaKey: data.ctaKey } : {}),
    ...(data.positionSeconds === undefined
      ? {}
      : { positionSeconds: Math.max(0, Math.min(86400, Math.floor(data.positionSeconds))) }),
    metadata,
  };
  window.dispatchEvent(new CustomEvent(WEBINAR_TRACKING_EVENT, {
    detail: { webinarId, eventType, data: payload },
  }));

  const url = `/api/webinars/${encodeURIComponent(webinarId)}/funnel-events`;
  const body = JSON.stringify(payload);
  if (options.beacon && navigator.sendBeacon) {
    try {
      const queued = navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
      if (queued) return true;
    } catch {
      // Fall through to a keepalive request when beacon queuing is unavailable.
    }
  }
  void fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    credentials: "same-origin",
    keepalive: true,
  }).catch(() => {
    // Analytics must never interrupt the viewer experience.
  });
  return true;
}

export async function openTrackedExternalUrl(
  webinarId: string | undefined,
  url: string,
  data: Pick<WebinarEventData, "ctaId" | "ctaKey"> & { watchToken?: string; sessionId?: string } = {},
): Promise<void> {
  const cta = isUuid(data.ctaId)
    ? { ctaId: data.ctaId }
    : isCtaKey(data.ctaKey)
      ? { ctaKey: data.ctaKey }
      : {};
  if ("ctaId" in cta || "ctaKey" in cta) trackWebinarEvent(webinarId, "cta_click", cta);
  // Only persisted CTA buttons can be attributed. Other external links retain
  // their normal behavior rather than being routed through this integration.
  if (!webinarId || !isUuid(data.ctaId)) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  // Opening during the click gesture keeps the original new-tab behavior. Do
  // not use noopener for an about:blank tab: browsers return null, orphaning it
  // before we can route the server-issued URL. Remove opener before navigation.
  const popup = window.open("", "_blank");
  try { if (popup) popup.opener = null; } catch {}
  const openDirectly = () => {
    if (popup && !popup.closed) popup.location.replace(url);
    else window.open(url, "_blank", "noopener,noreferrer");
  };
  let publicSettings: { approvedOrigins?: string[] };
  try {
    const settingsResponse = await fetch(`/api/webinars/${encodeURIComponent(webinarId)}/external-journey/public`, { credentials: "same-origin" });
    if (!settingsResponse.ok) return openDirectly();
    publicSettings = await settingsResponse.json() as { approvedOrigins?: string[] };
    const targetOrigin = new URL(url).origin;
    // An absent approved target means attribution is not opted in. Never make
    // historical CTA links depend on a new integration configuration.
    if (!publicSettings.approvedOrigins?.includes(targetOrigin)) return openDirectly();
  } catch {
    return openDirectly();
  }

  const createReferral = async (): Promise<boolean> => {
    try {
      const response = await fetch(`/api/webinars/${encodeURIComponent(webinarId)}/external-referrals`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(data.watchToken ? { "X-Watch-Token": data.watchToken } : {}),
      },
      credentials: "same-origin",
      body: JSON.stringify({
        targetKind: "cta",
        ctaId: data.ctaId,
        targetUrl: url,
        visitId: getWebinarVisitorToken(webinarId),
      }),
      });
      if (!response.ok) throw new Error("Unable to create attributed referral");
      const result = await response.json() as { redirectUrl?: string };
      if (!result.redirectUrl || !result.redirectUrl.startsWith("/r/")) throw new Error("Invalid attributed referral");
      const destination = new URL(result.redirectUrl, window.location.origin);
      if (destination.origin !== window.location.origin) throw new Error("Invalid attributed referral");
      if (popup && !popup.closed) popup.location.replace(destination.toString());
      else window.open(destination.toString(), "_blank", "noopener,noreferrer");
      return true;
    } catch {
      return false;
    }
  };
  if (await createReferral()) return;
  // Tracking was explicitly enabled for this target, so surface a retry rather
  // than silently dropping the referral. The CTA still opens its original URL
  // if the viewer declines or the retry also fails.
  if (window.confirm("無法建立歸因連結。要重試嗎？")) {
    if (await createReferral()) return;
  }
  openDirectly();
}

export async function openOfferCheckout(
  webinarId: string,
  ctaId: string,
  identity: { registrationId?: string; sessionId?: string; watchToken?: string; buyer?: { name: string; email: string } } = {},
): Promise<void> {
  trackWebinarEvent(webinarId, "cta_click", { ctaId });
  const popup = window.open("", "_blank");
  try {
    const response = await fetch(`/api/webinars/${encodeURIComponent(webinarId)}/offer-checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        ctaId,
        visitorToken: getWebinarVisitorToken(webinarId),
        ...identity,
      }),
    });
    if (!response.ok) throw new Error((await response.json().catch(() => null))?.message || "Unable to start checkout");
    const result = await response.json() as {
      provider?: "stripe" | "ecpay";
      url?: string;
      action?: string;
      fields?: Record<string, string | number>;
    };
    if (result.provider === "ecpay") {
      if (!result.action || !result.fields) throw new Error("ECPay checkout data is unavailable");
      const target = popup || window;
      const doc = target.document;
      const form = doc.createElement("form");
      form.method = "POST";
      form.action = result.action;
      for (const [name, value] of Object.entries(result.fields)) {
        const input = doc.createElement("input");
        input.type = "hidden";
        input.name = name;
        input.value = String(value);
        form.appendChild(input);
      }
      doc.body.appendChild(form);
      form.submit();
      return;
    }
    if (!result.url) throw new Error("Stripe Checkout URL is unavailable");
    if (popup) popup.location.href = result.url;
    else window.location.href = result.url;
  } catch (error) {
    popup?.close();
    throw error;
  }
}

/** Checkout a sales-page offer directly. The server remains authoritative for price and provider. */
export async function openSalesPageOfferCheckout(webinarId: string, pageId: string, offerId: string): Promise<void> {
  const popup = window.open("", "_blank");
  try {
    const response = await fetch(`/api/webinars/${encodeURIComponent(webinarId)}/offer-checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ salesPageId: pageId, offerId, visitorToken: getWebinarVisitorToken(webinarId) }),
    });
    if (!response.ok) throw new Error((await response.json().catch(() => null))?.message || "Unable to start checkout");
    const result = await response.json() as { provider?: "stripe" | "ecpay"; url?: string; action?: string; fields?: Record<string, string | number> };
    if (result.provider === "ecpay") {
      if (!result.action || !result.fields) throw new Error("ECPay checkout data is unavailable");
      const target = popup || window;
      const form = target.document.createElement("form");
      form.method = "POST"; form.action = result.action;
      Object.entries(result.fields).forEach(([name, value]) => {
        const input = target.document.createElement("input");
        input.type = "hidden"; input.name = name; input.value = String(value); form.appendChild(input);
      });
      target.document.body.appendChild(form); form.submit(); return;
    }
    if (!result.url) throw new Error("Stripe Checkout URL is unavailable");
    if (popup) popup.location.href = result.url; else window.location.href = result.url;
  } catch (error) {
    popup?.close(); throw error;
  }
}