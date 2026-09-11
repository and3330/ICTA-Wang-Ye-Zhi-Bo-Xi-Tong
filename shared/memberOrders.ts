import { z } from "zod";

/**
 * Stable, member-owned order-management API contract.
 *
 * This contract intentionally represents a seller's commerce orders only. It
 * never represents this application's subscription/SaaS invoices. Monetary
 * values are integer minor units; no floating point currency values are used.
 */
export const memberOrderPaymentStatuses = [
  "pending",
  "paid",
  "failed",
  "partially_refunded",
  "refunded",
] as const;
export type MemberOrderPaymentStatus = typeof memberOrderPaymentStatuses[number];

export const memberOrderFulfillmentStatuses = [
  "pending",
  "in_progress",
  "completed",
  "cancelled",
] as const;
export type MemberOrderFulfillmentStatus = typeof memberOrderFulfillmentStatuses[number];

export const memberOrderSnapshotSources = ["recorded", "legacy_live", "legacy_missing"] as const;
export type MemberOrderSnapshotSource = typeof memberOrderSnapshotSources[number];

export const memberOrderEventTypes = [
  "checkout_started",
  "payment_pending",
  "payment_paid",
  "payment_failed",
  "payment_refunded",
  "payment_provider_evidence",
  "fulfillment_changed",
  "internal_note_changed",
] as const;
export type MemberOrderEventType = typeof memberOrderEventTypes[number];

export const memberOrderProviderSchema = z.enum(["ecpay", "stripe"]);
export const memberOrderPaymentStatusSchema = z.enum(memberOrderPaymentStatuses);
export const memberOrderFulfillmentStatusSchema = z.enum(memberOrderFulfillmentStatuses);

/** ISO-8601 instant accepted by order date filters. */
export const memberOrderInstantSchema = z.string().datetime({ offset: true });

/**
 * GET /api/member/orders and GET /api/member/orders/export.csv query shape.
 * `from` and `to` are inclusive instants. Supplying date-only values is not a
 * supported timezone shortcut: clients must send an ISO instant with offset.
 */
const memberOrderFiltersBaseSchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  productId: z.string().uuid().optional(),
  paymentStatus: memberOrderPaymentStatusSchema.optional(),
  fulfillmentStatus: memberOrderFulfillmentStatusSchema.optional(),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/).transform(value => value.toUpperCase()).optional(),
  from: memberOrderInstantSchema.optional(),
  to: memberOrderInstantSchema.optional(),
}).strict();

export const memberOrderFiltersSchema = memberOrderFiltersBaseSchema.superRefine((value, ctx) => {
  if (value.from && value.to && new Date(value.from) > new Date(value.to)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["to"], message: "to must be greater than or equal to from" });
  }
});
export type MemberOrderFilters = z.infer<typeof memberOrderFiltersSchema>;

export const memberOrderListQuerySchema = memberOrderFiltersBaseSchema.extend({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
}).superRefine((value, ctx) => {
  if (value.from && value.to && new Date(value.from) > new Date(value.to)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["to"], message: "to must be greater than or equal to from" });
  }
});
export type MemberOrderListQuery = z.infer<typeof memberOrderListQuerySchema>;

/**
 * PATCH is deliberately narrow. Payment amounts, currency, buyer/product
 * snapshots, provider references, and payment status are not patchable.
 * `reason` is required for every operation so the immutable audit event has
 * meaningful operator context.
 */
export const updateMemberOrderSchema = z.object({
  expectedVersion: z.number().int().min(1),
  reason: z.string().trim().min(1).max(500),
  internalNote: z.string().max(5_000).nullable().optional(),
  fulfillmentStatus: memberOrderFulfillmentStatusSchema.optional(),
}).strict().refine(
  value => value.internalNote !== undefined || value.fulfillmentStatus !== undefined,
  "At least one editable field is required",
);
export type UpdateMemberOrderRequest = z.infer<typeof updateMemberOrderSchema>;

export interface MemberOrderProductSnapshot {
  id: string;
  name: string | null;
  /** `recorded` means immutable checkout data; legacy values are explicitly labeled. */
  nameSource: MemberOrderSnapshotSource;
}

export interface MemberOrderBuyerSnapshot {
  name: string | null;
  email: string | null;
  /** `recorded` means immutable checkout data; legacy values are explicitly labeled. */
  source: MemberOrderSnapshotSource;
}

export interface MemberOrderAttribution {
  source: "direct" | "webinar";
  webinarId: string | null;
  salesPageId: string | null;
  originSalesPageId: string | null;
  ctaId: string | null;
  registrationId: string | null;
}

/** Safe receipt fields only; credentials, status tokens, and raw callback data are excluded. */
export interface MemberOrderReceipt {
  provider: MemberOrderProvider;
  providerReference: string | null;
  providerStatus: string | null;
  providerStatusMessage: string | null;
  /** ECPay refunds are merchant-managed and may be stale or unavailable. */
  refundInformation: "authoritative" | "external_merchant_status_unknown";
}
export type MemberOrderProvider = z.infer<typeof memberOrderProviderSchema>;

export interface MemberOrderMoney {
  amountMinor: number;
  refundedMinor: number;
  netMinor: number;
  currency: string;
}

export interface MemberOrderListItem {
  id: string;
  createdAt: string;
  purchasedAt: string | null;
  paymentStatus: MemberOrderPaymentStatus;
  fulfillmentStatus: MemberOrderFulfillmentStatus;
  version: number;
  product: MemberOrderProductSnapshot;
  buyer: MemberOrderBuyerSnapshot;
  money: MemberOrderMoney;
  receipt: Pick<MemberOrderReceipt, "provider" | "providerReference" | "providerStatus">;
}

export interface MemberOrderEvent {
  id: string;
  type: MemberOrderEventType;
  occurredAt: string;
  /** Null for authoritative provider events; never exposes provider payloads. */
  actor: "provider" | "member" | null;
  reason: string | null;
  details: Record<string, string | number | boolean | null>;
}

export interface MemberOrderDetail extends MemberOrderListItem {
  internalNote: string | null;
  attribution: MemberOrderAttribution;
  receipt: MemberOrderReceipt;
  events: MemberOrderEvent[];
}

export interface MemberOrderListResponse {
  items: MemberOrderListItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface MemberOrderProductFilterOption {
  id: string;
  name: string | null;
  nameSource: MemberOrderSnapshotSource;
}

export interface MemberOrderProductFiltersResponse {
  items: MemberOrderProductFilterOption[];
  /** True when more than the bounded 500 owned products exist. */
  truncated: boolean;
}

export interface MemberOrderSummaryCurrency {
  currency: string;
  counts: Record<MemberOrderPaymentStatus, number>;
  paidGrossMinor: number;
  refundedMinor: number;
  netMinor: number;
}

export interface MemberOrderSummaryResponse {
  currencies: MemberOrderSummaryCurrency[];
}

export interface MemberOrderExportResponseHeaders {
  /** `true` means the CSV contains the maximum allowed rows and is incomplete. */
  "X-Export-Truncated": "true" | "false";
  /** Number of data rows emitted (not including the header). */
  "X-Export-Row-Count": string;
}