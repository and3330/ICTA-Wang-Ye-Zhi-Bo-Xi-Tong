import { loadMetaPixel } from "@/components/webinar-tracking-provider";
import type { MarketingConsent } from "@/lib/marketing-consent";

export const PLATFORM_PIXEL_ID = "1096741902746313";
export const PLATFORM_CONVERSION_PENDING_KEY = "sellcase.meta.platform.pending.v1";
const SENT_KEY_PREFIX = "sellcase.meta.platform.sent.v1";

export type PlatformConversion = {
  eventName: "CompleteRegistration" | "Purchase";
  eventId: string;
  accountMarker: string;
  value?: number;
  currency?: string;
};

type PendingConversion = PlatformConversion;

const memorySent = new Set<string>();
const memoryPending = new Map<string, PendingConversion>();

function storageAvailable(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    const key = "__sellcase_meta_conversion_test__";
    window.localStorage.getItem(key);
    return window.localStorage;
  } catch {
    return null;
  }
}

function storageKey(accountMarker: string, eventId: string): string {
  return `${SENT_KEY_PREFIX}.${encodeURIComponent(accountMarker)}.${encodeURIComponent(eventId)}`;
}

function hasSent(accountMarker: string, eventId: string): boolean {
  const key = storageKey(accountMarker, eventId);
  if (memorySent.has(key)) return true;
  const storage = storageAvailable();
  if (!storage) return false;
  try {
    return storage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function markSent(accountMarker: string, eventId: string) {
  const key = storageKey(accountMarker, eventId);
  memorySent.add(key);
  const storage = storageAvailable();
  try {
    storage?.setItem(key, "1");
  } catch {
    // The in-memory marker still protects this document when storage is
    // blocked. It is intentionally written only after fbq dispatch.
  }
}

function readPending(): PendingConversion[] {
  const storage = storageAvailable();
  if (!storage) return Array.from(memoryPending.values());
  try {
    const parsed = JSON.parse(storage.getItem(PLATFORM_CONVERSION_PENDING_KEY) || "[]");
    if (!Array.isArray(parsed)) return Array.from(memoryPending.values());
    return parsed.filter((item): item is PendingConversion =>
      item
      && (item.eventName === "CompleteRegistration" || item.eventName === "Purchase")
      && typeof item.eventId === "string"
      && typeof item.accountMarker === "string"
      && (item.value === undefined || typeof item.value === "number")
      && (item.currency === undefined || typeof item.currency === "string"),
    );
  } catch {
    return Array.from(memoryPending.values());
  }
}

function writePending(items: PendingConversion[]) {
  memoryPending.clear();
  for (const item of items) memoryPending.set(`${item.accountMarker}:${item.eventId}`, item);
  const storage = storageAvailable();
  try {
    storage?.setItem(PLATFORM_CONVERSION_PENDING_KEY, JSON.stringify(items.slice(-50)));
  } catch {
    // Keep the bounded in-memory queue for the current document.
  }
}

function queuePending(conversion: PendingConversion) {
  const items = readPending().filter(item =>
    !(item.accountMarker === conversion.accountMarker && item.eventId === conversion.eventId));
  items.push(conversion);
  writePending(items);
}

export function clearPlatformConversionsPending() {
  memoryPending.clear();
  const storage = storageAvailable();
  try {
    storage?.removeItem(PLATFORM_CONVERSION_PENDING_KEY);
  } catch {
    // Ignore storage failures; the in-memory queue has already been cleared.
  }
}

function dispatch(conversion: PlatformConversion, consent: MarketingConsent): boolean {
  if (consent !== "granted" || hasSent(conversion.accountMarker, conversion.eventId)) return false;
  // This path is also used on the dashboard after leaving the marketing
  // routes, so load the platform pixel here rather than relying on a prior
  // homepage visit. `false` permanently disables automatic events.
  loadMetaPixel(PLATFORM_PIXEL_ID, false);
  window.fbq?.("consent", "grant");
  const payload = conversion.eventName === "Purchase"
    ? { value: conversion.value, currency: conversion.currency }
    : {};
  window.fbq?.(
    "trackSingle",
    PLATFORM_PIXEL_ID,
    conversion.eventName,
    payload,
    { eventID: conversion.eventId },
  );
  markSent(conversion.accountMarker, conversion.eventId);
  return true;
}

/**
 * Report only server-authorized platform events. The account marker is an
 * opaque local-scope key and is never sent to Meta.
 */
export function trackPlatformConversion(
  conversion: PlatformConversion,
  consent: MarketingConsent | null,
): boolean {
  if (
    !conversion.accountMarker
    || !conversion.eventId
    || (conversion.eventName === "Purchase"
      && (!Number.isFinite(conversion.value) || !conversion.currency))
  ) return false;
  if (consent === "granted") {
    const sent = dispatch(conversion, consent);
    if (sent) {
      const remaining = readPending().filter(item =>
        !(item.accountMarker === conversion.accountMarker && item.eventId === conversion.eventId));
      writePending(remaining);
    }
    return sent;
  }
  // A missing choice can be deferred until the visitor makes one. An explicit
  // denial is never queued, preventing a later account from inheriting it.
  if (consent === null) queuePending(conversion);
  return false;
}

/**
 * Flush only the current account's pending events. This account fence is
 * important when a browser logs out and another member logs in before consent.
 */
export function flushPlatformConversions(
  accountMarker: string,
  consent: MarketingConsent | null,
): number {
  if (consent !== "granted" || !accountMarker) return 0;
  const pending = readPending();
  const remaining: PendingConversion[] = [];
  let sentCount = 0;
  for (const conversion of pending) {
    if (conversion.accountMarker !== accountMarker) {
      remaining.push(conversion);
      continue;
    }
    if (dispatch(conversion, consent)) sentCount += 1;
    else remaining.push(conversion);
  }
  writePending(remaining);
  return sentCount;
}
