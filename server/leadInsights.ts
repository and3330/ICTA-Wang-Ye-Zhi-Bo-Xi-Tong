import type { Registration, WebinarFunnelEvent, Webinar } from "@shared/schema";

export type LeadStage = "registered" | "engaged" | "considering" | "checkout" | "converted" | "refunded";
export type LeadTemperature = "cold" | "warm" | "hot" | "customer";

export interface LeadInsight {
  registrationId: string;
  score: number;
  stage: LeadStage;
  temperature: LeadTemperature;
  lastActivityAt: string | null;
  recommendation: { title: string; description: string; action: string };
  suppressSalesFollowUp: boolean;
  evidenceCount: number;
  evidence: Array<{ type: string; label: string; points: number; occurredAt: string }>;
  timeline: Array<{ id: string; eventType: string; label: string; occurredAt: string; positionSeconds: number | null; amountMinor: number | null; currency: string | null; ctaKey: string | null }>;
}

const eventText: Record<string, string> = {
  landing_view: "瀏覽成交頁",
  registration: "完成報名",
  webinar_enter: "進入銷講",
  cta_view: "查看商品方案",
  cta_click: "點擊商品方案",
  checkout_start: "開始結帳",
  purchase: "完成購買",
  refund: "收到退款",
  dropoff: "離開銷講",
};

function eventTime(event: WebinarFunnelEvent): number {
  return event.occurredAt instanceof Date ? event.occurredAt.getTime() : new Date(event.occurredAt).getTime();
}

function progressPercent(event: WebinarFunnelEvent, videoDuration: number): number | null {
  const fromMetadata = event.metadata?.progressPercent;
  if (typeof fromMetadata === "number" && Number.isFinite(fromMetadata)) return Math.max(0, Math.min(100, fromMetadata));
  if (event.positionSeconds !== null && videoDuration > 0) {
    return Math.max(0, Math.min(100, (event.positionSeconds / videoDuration) * 100));
  }
  return null;
}

/** Pure, deterministic scoring. Events are expected to belong to one registration. */
export function scoreLeadInsight(
  registration: Pick<Registration, "id" | "registeredAt"> & Partial<Pick<Registration, "attended" | "attendedAt" | "watchDuration">>,
  events: WebinarFunnelEvent[],
  videoDuration = 0,
): LeadInsight {
  // The registration row also records attendance (from the viewer's watch
  // link), even when room events were sent without the registration attached.
  const attendedAt = registration.attendedAt ? new Date(registration.attendedAt) : null;
  const attendanceEvents: WebinarFunnelEvent[] = [];
  const hasEventType = (type: string) => events.some(e => e.eventType === type);
  if (registration.attended && !hasEventType("webinar_enter")) {
    attendanceEvents.push({
      id: `attendance-enter-${registration.id}`, eventType: "webinar_enter", registrationId: registration.id,
      occurredAt: attendedAt ?? new Date(registration.registeredAt ?? 0),
    } as WebinarFunnelEvent);
  }
  if ((registration.watchDuration ?? 0) > 0 && videoDuration > 0) {
    attendanceEvents.push({
      id: `attendance-progress-${registration.id}`, eventType: "video_progress", registrationId: registration.id,
      positionSeconds: Math.min(videoDuration, registration.watchDuration!), metadata: {},
      occurredAt: attendedAt ?? new Date(registration.registeredAt ?? 0),
    } as unknown as WebinarFunnelEvent);
  }
  const ordered = [...events, ...attendanceEvents].sort((a, b) => eventTime(a) - eventTime(b) || a.id.localeCompare(b.id));
  const has = (type: string) => ordered.some(e => e.eventType === type);
  const progressEvents = ordered.filter(e => e.eventType === "video_progress");
  const progress = progressEvents.reduce<number | null>((max, e) => {
    const value = progressPercent(e, videoDuration);
    return value === null ? max : max === null ? value : Math.max(max, value);
  }, null);
  const purchaseTotals = new Map<string, number>();
  const refundTotals = new Map<string, number>();
  for (const event of ordered) {
    if ((event.eventType !== "purchase" && event.eventType !== "refund") || !event.currency || event.amountMinor === null) continue;
    const totals = event.eventType === "purchase" ? purchaseTotals : refundTotals;
    totals.set(event.currency, (totals.get(event.currency) || 0) + Math.max(0, event.amountMinor));
  }
  const purchased = Array.from(purchaseTotals.values()).some(amount => amount > 0);
  // Financial state is amount-based, not timestamp-based: payment reconciliation
  // may persist purchase/refund events in either order or at the same instant.
  const refunded = purchased && Array.from(purchaseTotals.entries()).every(
    ([currency, purchasedAmount]) => purchasedAmount > 0 && (refundTotals.get(currency) || 0) >= purchasedAmount,
  );
  let score = 10; // registration baseline, including registrations whose event was not retained
  const evidence: LeadInsight["evidence"] = [{
    type: "registration", label: "已完成報名", points: 10,
    occurredAt: new Date(registration.registeredAt ?? 0).toISOString(),
  }];
  if (has("webinar_enter")) { score += 10; }
  if (progress !== null) {
    const points = Math.round(progress * 0.2);
    score += points;
    evidence.push({ type: "video_progress", label: `影片觀看至 ${Math.round(progress)}%`, points, occurredAt: new Date(Math.max(...progressEvents.map(eventTime))).toISOString() });
  }
  if (has("webinar_enter")) {
    const e = ordered.find(e => e.eventType === "webinar_enter")!;
    evidence.push({ type: "webinar_enter", label: "進入 webinar", points: 10, occurredAt: new Date(eventTime(e)).toISOString() });
  }
  if (has("cta_view")) { score += 5; const e = ordered.find(e => e.eventType === "cta_view")!; evidence.push({ type: "cta_view", label: "查看方案 CTA", points: 5, occurredAt: new Date(eventTime(e)).toISOString() }); }
  if (has("cta_click")) { score += 15; const e = ordered.find(e => e.eventType === "cta_click")!; evidence.push({ type: "cta_click", label: "點擊方案 CTA", points: 15, occurredAt: new Date(eventTime(e)).toISOString() }); }
  if (has("checkout_start")) { score += 20; const e = ordered.find(e => e.eventType === "checkout_start")!; evidence.push({ type: "checkout_start", label: "開始結帳", points: 20, occurredAt: new Date(eventTime(e)).toISOString() }); }
  score = Math.max(0, Math.min(100, score));
  if (purchased && !refunded) score = 100;

  let stage: LeadStage = "registered";
  if (has("webinar_enter") || progress !== null) stage = "engaged";
  if (has("cta_view") || has("cta_click")) stage = "considering";
  if (has("checkout_start")) stage = "checkout";
  if (purchased) stage = "converted";
  if (refunded) { stage = "refunded"; score = 0; }
  let temperature: LeadTemperature = score >= 70 ? "hot" : score >= 30 ? "warm" : "cold";
  if (purchased && !refunded) temperature = "customer";
  if (refunded) temperature = "cold";

  let recommendation: LeadInsight["recommendation"];
  if (refunded) recommendation = { title: "停止促銷", description: "這位客戶已退款，應先了解體驗與原因。", action: "停止銷售追蹤並關懷退款體驗" };
  else if (purchased) recommendation = { title: "安排客戶成功", description: "交易已完成，先協助客戶上手，再評估後續交叉銷售。", action: "開始 onboarding，稍後再評估交叉銷售" };
  else if (stage === "checkout") recommendation = { title: "挽回結帳", description: "對方已開始結帳但尚未完成，提供不施壓的協助。", action: "提供結帳協助並重新帶回方案" };
  else if (has("cta_view") || has("cta_click")) recommendation = { title: "處理疑慮", description: "對方已接觸方案，適合補充證據與價值。", action: "回答可能的疑慮並重新呈現方案" };
  else if (stage === "engaged") recommendation = { title: "深化興趣", description: "對方已觀看內容，補充實例與價值有助於推進。", action: "分享案例、證據與實用價值" };
  else recommendation = { title: "邀請觀看", description: "目前只有報名紀錄，先邀請對方觀看 webinar。", action: "邀請觀看 webinar" };

  const timeline = ordered.map(event => {
    let label = eventText[event.eventType] ?? event.eventType;
    if (event.eventType === "video_progress") {
      const p = progressPercent(event, videoDuration);
      label = p === null ? "記錄影片進度" : `影片進度 ${Math.round(p)}%`;
    }
    return { id: event.id, eventType: event.eventType, label, occurredAt: new Date(eventTime(event)).toISOString(), positionSeconds: event.positionSeconds, amountMinor: event.amountMinor, currency: event.currency, ctaKey: event.ctaKey };
  });
  return { registrationId: registration.id, score, stage, temperature, lastActivityAt: ordered.length ? new Date(eventTime(ordered[ordered.length - 1])).toISOString() : null, recommendation, suppressSalesFollowUp: refunded, evidenceCount: evidence.length, evidence, timeline };
}

export function buildLeadInsights(
  registrations: Registration[],
  events: WebinarFunnelEvent[],
  webinar: Pick<Webinar, "videoDuration">,
  videoDuration = webinar.videoDuration ?? 0,
) {
  const eventsByRegistration = new Map<string, WebinarFunnelEvent[]>();
  for (const event of events) {
    if (!event.registrationId) continue;
    const grouped = eventsByRegistration.get(event.registrationId);
    if (grouped) grouped.push(event);
    else eventsByRegistration.set(event.registrationId, [event]);
  }
  const insights = registrations.map(registration =>
    scoreLeadInsight(registration, eventsByRegistration.get(registration.id) || [], videoDuration));
  return { summary: { total: insights.length, cold: insights.filter(i => i.temperature === "cold" && i.stage !== "refunded").length, warm: insights.filter(i => i.temperature === "warm").length, hot: insights.filter(i => i.temperature === "hot").length, customers: insights.filter(i => i.temperature === "customer").length, refunded: insights.filter(i => i.stage === "refunded").length }, insights };
}