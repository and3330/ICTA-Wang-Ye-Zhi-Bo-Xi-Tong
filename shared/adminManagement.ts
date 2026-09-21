/**
 * Management API contract
 * Base path: /api/management. All endpoints require the server session and return
 * { message: string } for errors. Timestamps are ISO-8601 strings; money is
 * integer minor units. The client must use `me.permissions` to render actions,
 * but the server enforces every permission independently.
 */
import type { EffectiveMemberPlanDto, MemberManualPlanDto } from "./memberManualPlans";

export const managementRoles = ["member", "support", "billing", "read_only", "super_admin"] as const;
export type ManagementRole = typeof managementRoles[number];

export const managementPermissions = [
  "members.read", "members.write", "members.disable", "members.roles",
  "subscriptions.read", "subscriptions.write", "billing.read", "billing.refund",
  "credits.read", "credits.grant", "support.read", "support.write",
  "audit.read", "audit.export",
  "course_marketplace.read", "course_marketplace.review",
] as const;
export type ManagementPermission = typeof managementPermissions[number];

export type ManagementMeDto = {
  id: string; username: string; managementRole: ManagementRole;
  canManage: boolean; permissions: ManagementPermission[]; isRoot: boolean;
};
export type PageMetaDto = { page: number; pageSize: number; total: number | null; hasMore?: boolean };
export type CollectionAvailabilityDto = {
  provider: "stripe" | "local"; available: boolean; source: "live" | "local";
  message: string | null;
};
export type PaginatedDto<T> = PageMetaDto & { items: T[]; availability?: CollectionAvailabilityDto[] };

export type MemberListItemDto = {
  id: string; username: string; email: string; companyName: string;
  isActive: boolean; protectedRoot: boolean; managementRole: ManagementRole;
  subscriptionPlan?: string; subscriptionStatus?: string; planExpiresAt?: string | null;
  createdAt: string | null; webinarCount: number; aiPoints?: number;
};
export type MemberProfileDto = MemberListItemDto & {
  emailVerificationRequired: boolean; emailVerifiedAt: string | null;
  notes: string[]; tags: string[];
};
export type EntitlementOverrideDto = {
  id: string; userId: string; publishingSlots: number; startsAt: string;
  expiresAt: string; reason: string; createdAt: string; createdBy: string;
};
export type AiCreditLotDto = {
  id: string; source: string; originalPoints: number; remainingPoints: number;
  grantedAt: string; expiresAt: string | null; idempotencyKey: string | null;
};
export type AiLedgerEntryDto = {
  id: string; type: string; points: number; amountMinor: number | null;
  currency: string | null; createdAt: string; source: string | null;
};
export type MemberUsageDto = {
  webinars: number; publishedWebinars: number; registrations: number;
  aiPoints: number; aiLots: AiCreditLotDto[];
};
export type MemberDetailDto = {
  profile: MemberProfileDto; override?: EntitlementOverrideDto | null;
  /** Paid Stripe-derived billing only; manual grants never change this object. */
  subscription?: SubscriptionDto | null;
  /** Retained manual grant, including pending/expired/revoked state. */
  manualPlan?: MemberManualPlanDto | null;
  /** Capacity composed from paid and active manual entitlement. */
  effectivePlan?: EffectiveMemberPlanDto;
  usage?: MemberUsageDto;
  webinars: Array<{ id: string; title: string; publishStatus: string; createdAt: string | null }>;
  products?: Array<{ id: string; name: string; status: string; createdAt: string | null }>;
};

export type SubscriptionDto = {
  userId: string; username: string; email: string; plan: string; status: string;
  interval: "month" | "year" | "trial" | "legacy" | null; amountMinor: number | null;
  currency: string | null; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean;
  provider: "stripe" | "none"; providerSubscriptionPresent: boolean;
  providerEnvironment: "connected" | "unavailable" | "error";
  receiptUrl: string | null;
};
export type OrderDto = {
  id: string; kind: "platform_invoice" | "ai_purchase" | "member_order";
  ownerUserId: string; ownerUsername: string; provider: "stripe" | "ecpay";
  providerReference: string | null; status: string; amountMinor: number;
  refundedMinor: number; currency: string; createdAt: string; paidAt: string | null;
  providerLookup: "local" | "live" | "unavailable" | "error";
  receiptUrl: string | null; providerEnvironment: "connected" | "unavailable" | "error";
  providerMode: "stage" | "production" | "connected" | "unknown";
  providerAccountLabel: string | null;
};
export type SupportCaseDto = {
  id: string; userId: string; username: string; category: string; subject: string;
  message: string; status: string; adminNote: string | null;
  createdAt: string; updatedAt: string;
};
export type AuditEventDto = {
  id: string; actorUserId: string | null; targetUserId: string | null; action: string;
  reason: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null;
  createdAt: string; requestId: string | null;
};
export type ManagementOverviewDto = {
  totals: { users: number; activeUsers: number; disabledUsers: number; paidSubscriptions: number; openSupportCases: number };
  warnings: Array<{ code: string; count: number; message: string }>;
};
export type ManagementCatalogDto = {
  plans: Array<{ key: string; label: string; monthlyAmountMinor: number; annualAmountMinor: number; currency: "USD"; baseWebinars: number; monthlyAiPoints: number }>;
  roles: Array<{ role: ManagementRole; permissions: ManagementPermission[] }>;
};