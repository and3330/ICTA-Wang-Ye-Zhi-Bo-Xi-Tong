import { z } from "zod";

/** Stable API contract for a member's externally-hosted registration journey. */
export const externalOriginSchema = z.string().trim().max(2048).transform((value, ctx) => {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.pathname !== "/" || url.search || url.hash) throw new Error();
    return url.origin;
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Origin must be a credential-free HTTPS origin" });
    return z.NEVER;
  }
});

export const externalHttpsUrlSchema = z.string().trim().min(1).max(2048).superRefine((value, ctx) => {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) throw new Error();
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "URL must be an absolute credential-free HTTPS URL" });
  }
});

export const externalJourneyModeSchema = z.enum(["builtin", "external"]);
export const externalJourneySettingsSchema = z.object({
  landingMode: externalJourneyModeSchema.default("builtin"),
  landingUrl: externalHttpsUrlSchema.optional(),
  thankYouMode: externalJourneyModeSchema.default("builtin"),
  thankYouUrl: externalHttpsUrlSchema.optional(),
  approvedOrigins: z.array(externalOriginSchema).max(20).default([]),
  approvedEmbedOrigins: z.array(externalOriginSchema).max(20).default([]),
  secureHandoffEnabled: z.boolean().default(false),
  includeWatchLinkInHandoff: z.boolean().default(false),
  /** Explicit opt-in for authenticated server-to-server name/email exchange. */
  includeContactInHandoff: z.boolean().default(false),
}).strict().superRefine((value, ctx) => {
  if (value.landingMode === "external" && !value.landingUrl) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["landingUrl"], message: "External landing requires landingUrl" });
  if (value.landingMode === "builtin" && value.landingUrl) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["landingUrl"], message: "Builtin landing cannot have landingUrl" });
  if (value.thankYouMode === "external" && !value.thankYouUrl) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["thankYouUrl"], message: "External thank-you requires thankYouUrl" });
  if (value.thankYouMode === "builtin" && value.thankYouUrl) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["thankYouUrl"], message: "Builtin thank-you cannot have thankYouUrl" });
  if (value.includeWatchLinkInHandoff && !value.secureHandoffEnabled) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["includeWatchLinkInHandoff"], message: "Watch links require secure handoff" });
  if (value.includeContactInHandoff && !value.secureHandoffEnabled) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["includeContactInHandoff"], message: "Contact exchange requires secure handoff" });
});
// Keep newly introduced opt-ins source-compatible for independently deployed
// clients. Parsing always materializes `false`; callers may omit this input.
export type ExternalJourneySettingsInput = Omit<z.infer<typeof externalJourneySettingsSchema>, "includeContactInHandoff"> & {
  includeContactInHandoff?: boolean;
};

export const externalJourneySaveSchema = z.object({
  version: z.number().int().positive(),
  settings: externalJourneySettingsSchema,
}).strict();
export const externalJourneyPublishSchema = z.object({ version: z.number().int().positive() }).strict();
export const externalJourneyRecordSchema = z.object({
  id: z.string().uuid().optional(),
  webinarId: z.string().uuid().optional(),
  version: z.number().int().positive(),
  settings: externalJourneySettingsSchema,
  publishedSettings: externalJourneySettingsSchema.nullable().optional(),
  publishedAt: z.coerce.date().nullable().optional(),
  createdAt: z.coerce.date().optional(),
  updatedAt: z.coerce.date().optional(),
}).strict();
export const externalJourneyConnectionSchema = z.object({
  connected: z.boolean(),
  version: z.number().int().positive().nullable(),
  rotatedAt: z.string().datetime({ offset: true }).nullable(),
  merchantEventsPath: z.string().startsWith("/"),
  handoffExchangePath: z.string().startsWith("/"),
}).strict();

export const externalReferralRequestSchema = z.object({
  targetKind: z.enum(["cta", "thank_you"]),
  ctaId: z.string().uuid().optional(),
  targetUrl: externalHttpsUrlSchema,
  visitId: z.string().regex(/^[A-Za-z0-9_-]{24,128}$/).optional(),
  /** A persisted webinar session ID, never a registration ID. */
  sessionId: z.string().uuid().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.targetKind === "cta" && !value.ctaId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["ctaId"], message: "CTA referral requires ctaId" });
  if (value.targetKind === "thank_you" && value.ctaId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["ctaId"], message: "Thank-you referral cannot include ctaId" });
});

export const externalBrowserReportSchema = z.object({
  scRef: z.string().regex(/^[A-Za-z0-9_-]{24,128}$/),
  orderId: z.string().trim().min(1).max(160),
  amountMinor: z.number().int().min(0).max(2_000_000_000),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/).transform(value => value.toUpperCase()),
}).strict();
export const externalHandoffExchangeSchema = z.object({
  handoff: z.string().regex(/^[A-Za-z0-9_-]{24,128}$/),
}).strict();

export const externalMerchantEventSchema = z.object({
  eventId: z.string().trim().min(1).max(160),
  orderId: z.string().trim().min(1).max(160),
  type: z.enum(["purchase", "refund"]),
  amountMinor: z.number().int().min(0).max(2_000_000_000),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/).transform(value => value.toUpperCase()),
  scRef: z.string().regex(/^[A-Za-z0-9_-]{24,128}$/).optional(),
  occurredAt: z.string().datetime({ offset: true }).optional(),
}).strict();

export const externalOrderListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().min(1).max(160).optional(),
  sourceTrust: z.enum(["browser_reported", "merchant_reported"]).optional(),
  sessionId: z.string().uuid().optional(),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/).transform(value => value.toUpperCase()).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.from && value.to && new Date(value.from) > new Date(value.to)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["to"], message: "to must be greater than or equal to from" });
});

export interface ExternalJourneyPublicSettings {
  landingMode: "builtin" | "external";
  landingUrl?: string;
  thankYouMode: "builtin" | "external";
  approvedOrigins: string[];
  approvedEmbedOrigins: string[];
}

export interface ExternalOrderDto {
  id: string;
  orderId: string;
  webinarId: string;
  sessionId: string | null;
  sourceTrust: "browser_reported" | "merchant_reported";
  currency: string;
  /** Null while only a refund is known and no purchase has been observed. */
  grossPaidMinor: number | null;
  refundedMinor: number;
  netMinor: number | null;
  createdAt: string;
  updatedAt: string;
}
export const externalOrderDtoSchema = z.object({
  id: z.string().uuid(),
  orderId: z.string(),
  webinarId: z.string().uuid(),
  sessionId: z.string().uuid().nullable(),
  selectedSession: z.string().datetime({ offset: true }).nullable(),
  sourceTrust: z.enum(["browser_reported", "merchant_reported"]),
  currency: z.string().regex(/^[A-Z]{3}$/),
  purchaseObserved: z.boolean(),
  grossPaidMinor: z.number().int().min(0).nullable(),
  refundedMinor: z.number().int().min(0),
  netMinor: z.number().int().min(0).nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
}).strict();