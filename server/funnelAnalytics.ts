import crypto from "node:crypto";
import { z } from "zod";
import {
  webinarFunnelEventTypes,
  type WebinarFunnelEvent,
  type WebinarFunnelEventType,
  type WebinarFunnelMetadata,
  analyticsVisitorTokenSchema,
} from "@shared/schema";

const boundedText = z.string().trim().min(1).max(100);
const metadataSchema = z.object({
  source: boundedText.optional(),
  medium: boundedText.optional(),
  campaign: boundedText.optional(),
  term: boundedText.optional(),
  content: boundedText.optional(),
  reason: z.enum(["pause", "navigate", "close", "ended", "unknown"]).optional(),
  progressPercent: z.number().finite().min(0).max(100).optional(),
}).strict().default({});

export const funnelEventInputSchema = z.object({
  eventType: z.enum(webinarFunnelEventTypes),
  registrationId: z.string().uuid().optional(),
  sessionId: z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9_-]+$/).optional(),
  ctaId: z.string().uuid().optional(),
  ctaKey: z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/).optional(),
  visitorToken: analyticsVisitorTokenSchema.optional(),
  positionSeconds: z.number().int().min(0).max(60 * 60 * 24).optional(),
  value: z.number().finite().min(0).max(999999999999.99).optional(),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/).transform(value => value.toUpperCase()).optional(),
  dedupeKey: z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9_.:-]+$/),
  metadata: metadataSchema,
}).strict().superRefine((value, context) => {
  if (!value.registrationId && !value.sessionId && !value.visitorToken) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "An anonymous visitor token or safe identifier is required" });
  }
  if ((value.eventType === "video_progress" || value.eventType === "dropoff") && value.positionSeconds === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["positionSeconds"], message: "positionSeconds is required for this event" });
  }
    if ((value.eventType === "cta_view" || value.eventType === "cta_click") && !value.ctaId && !value.ctaKey) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "ctaId or ctaKey is required for CTA events" });
    }
    if (value.ctaKey && value.eventType !== "cta_view" && value.eventType !== "cta_click") {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["ctaKey"], message: "ctaKey is only allowed for CTA events" });
  }
  if (value.eventType === "purchase") {
    if (value.value === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ["value"], message: "value is required for purchase" });
    if (!value.currency) context.addIssue({ code: z.ZodIssueCode.custom, path: ["currency"], message: "currency is required for purchase" });
  } else if (value.value !== undefined || value.currency !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "value and currency are only allowed for purchase events" });
  }
});

export type FunnelEventInput = z.infer<typeof funnelEventInputSchema>;

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

export function funnelDedupeKey(eventType: WebinarFunnelEventType, clientKey: string, registrationId?: string): string {
  return eventType === "registration" && registrationId
    ? sha256(`registration:${registrationId}`)
    : sha256(`${eventType}:${clientKey}`);
}

/** Server-only event payload used in the registration transaction; raw tokens never leave this function. */
export function authoritativeRegistrationFunnelEvent(webinarId: string, registrationId: string, analyticsVisitorToken?: string) {
  return {
    webinarId,
    eventType: "registration" as const,
    registrationId,
    visitorTokenHash: analyticsVisitorToken ? sha256(analyticsVisitorToken) : null,
    dedupeKey: sha256(`registration:${registrationId}`),
    metadata: { serverRecorded: true },
  };
}

function viewerKey(event: Pick<WebinarFunnelEvent, "visitorTokenHash" | "registrationId" | "sessionId" | "id">): string {
  return event.visitorTokenHash
    ? `v:${event.visitorTokenHash}`
    : event.registrationId
      ? `r:${event.registrationId}`
      : event.sessionId
        ? `s:${event.sessionId}`
        : `e:${event.id}`;
}

const stages: WebinarFunnelEventType[] = [
  "landing_view", "registration", "webinar_enter", "cta_view",
  "cta_click", "checkout_start", "purchase",
];

export function aggregateFunnelEvents(events: WebinarFunnelEvent[], videoDuration: number) {
  const counts = Object.fromEntries(webinarFunnelEventTypes.map(type => [type, 0])) as Record<WebinarFunnelEventType, number>;
  const uniqueByType = Object.fromEntries(webinarFunnelEventTypes.map(type => [type, new Set<string>()])) as Record<WebinarFunnelEventType, Set<string>>;
  const allViewers = new Set<string>();
  const ctas = new Map<string, { ctaKey: string; views: number; clicks: number; uniqueViews: Set<string>; uniqueClicks: Set<string> }>();
  const dropoffBuckets = [
    { range: "0-25%", count: 0 },
    { range: "25-50%", count: 0 },
    { range: "50-75%", count: 0 },
    { range: "75-100%", count: 0 },
  ];
  const revenue: Record<string, number> = {};

  for (const event of events) {
    counts[event.eventType]++;
    const key = viewerKey(event);
    uniqueByType[event.eventType].add(key);
    allViewers.add(key);
    if (event.ctaKey && (event.eventType === "cta_view" || event.eventType === "cta_click")) {
      const item = ctas.get(event.ctaKey) ?? { ctaKey: event.ctaKey, views: 0, clicks: 0, uniqueViews: new Set<string>(), uniqueClicks: new Set<string>() };
      if (event.eventType === "cta_view") {
        item.views++;
        item.uniqueViews.add(key);
      } else {
        item.clicks++;
        item.uniqueClicks.add(key);
      }
      ctas.set(event.ctaKey, item);
    }
    if (event.eventType === "dropoff" && event.positionSeconds !== null && videoDuration > 0) {
      const index = Math.min(3, Math.floor((event.positionSeconds / videoDuration) * 4));
      dropoffBuckets[index].count++;
    }
    if (event.eventType === "purchase" && event.currency && event.value !== null) {
      revenue[event.currency] = (revenue[event.currency] ?? 0) + Number(event.value);
    }
  }

  const uniqueCounts = Object.fromEntries(webinarFunnelEventTypes.map(type => [type, uniqueByType[type].size])) as Record<WebinarFunnelEventType, number>;
  const stageConversionRates = stages.slice(1).map((stage, index) => {
    const from = stages[index];
    const denominator = uniqueCounts[from];
    return {
      from,
      to: stage,
      rate: denominator ? Math.round((uniqueCounts[stage] / denominator) * 10000) / 100 : 0,
    };
  });
  return {
    counts,
    uniqueViewers: allViewers.size,
    uniqueByStage: uniqueCounts,
    stageConversionRates,
    ctaPerformance: Array.from(ctas.values()).map(item => ({
      ctaKey: item.ctaKey,
      views: item.views,
      clicks: item.clicks,
      uniqueViews: item.uniqueViews.size,
      uniqueClicks: item.uniqueClicks.size,
      clickThroughRate: item.uniqueViews.size
        ? Math.round((item.uniqueClicks.size / item.uniqueViews.size) * 10000) / 100
        : 0,
    })),
    dropoffBuckets,
    revenue,
  };
}

export function safeRequestMetadata(
  metadata: z.infer<typeof metadataSchema>,
  context: { referrer?: string; userAgent?: string; ip?: string; hashSalt: string },
): WebinarFunnelMetadata {
  let referrerHost: string | undefined;
  if (context.referrer) {
    try {
      referrerHost = new URL(context.referrer).hostname.slice(0, 253);
    } catch {
      // Invalid referrers are discarded rather than persisted.
    }
  }
  return {
    ...metadata,
    ...(referrerHost ? { referrerHost } : {}),
    ...(context.userAgent ? { userAgent: context.userAgent.slice(0, 200) } : {}),
    ...(context.ip ? { ipHash: sha256(`${context.hashSalt}:${context.ip}`) } : {}),
  };
}