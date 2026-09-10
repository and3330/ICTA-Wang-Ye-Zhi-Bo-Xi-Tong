import { z } from "zod";

const blockIdSchema = z.string().trim().min(1).max(64)
  .regex(/^[A-Za-z0-9_-]+$/, "Block IDs may contain only letters, numbers, underscores, and hyphens");
const shortText = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).optional();

/** Copy used for both editor validation and public rendering. Keep defaults
 * deliberately generic so old pages can be read without a migration rewrite. */
export const DEFAULT_CHECKOUT_SETTINGS = {
  transitionTitle: "正在前往安全付款頁面",
  transitionMessage: "請稍候，我們正在準備您的付款。",
  successTitle: "付款成功，謝謝您的支持！",
  successMessage: "您的購買已確認。",
  successButtonLabel: "前往內容",
  successButtonUrl: undefined as string | undefined,
  cancelTitle: "付款尚未完成",
  cancelMessage: "您可以返回優惠頁，再試一次。",
};
const safeCheckoutUrl = z.preprocess(value => value === "" ? undefined : value, z.string().trim().max(2048).refine(value => {
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}, "網址必須是 HTTPS 或同源相對路徑").optional());
export const checkoutSettingsSchema = z.object({
  transitionTitle: shortText(200).default(DEFAULT_CHECKOUT_SETTINGS.transitionTitle),
  transitionMessage: shortText(600).default(DEFAULT_CHECKOUT_SETTINGS.transitionMessage),
  successTitle: shortText(200).default(DEFAULT_CHECKOUT_SETTINGS.successTitle),
  successMessage: shortText(600).default(DEFAULT_CHECKOUT_SETTINGS.successMessage),
  successButtonLabel: shortText(80).default(DEFAULT_CHECKOUT_SETTINGS.successButtonLabel),
  successButtonUrl: safeCheckoutUrl.optional(),
  cancelTitle: shortText(200).default(DEFAULT_CHECKOUT_SETTINGS.cancelTitle),
  cancelMessage: shortText(600).default(DEFAULT_CHECKOUT_SETTINGS.cancelMessage),
}).strict();
export type CheckoutSettings = z.infer<typeof checkoutSettingsSchema>;
export function normalizeCheckoutSettings(value: unknown): CheckoutSettings {
  return checkoutSettingsSchema.parse(value ?? {});
}

export const salesPageImageUrlSchema = z.string().trim().min(1).max(2048).refine((value) => {
  if (/^\/uploads\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}, "Images must use HTTPS or a same-origin /uploads/filename URL; sales-page uploads are not provided by this API");

const base = {
  id: blockIdSchema,
  enabled: z.boolean(),
};

export const salesPageBlockSchema = z.discriminatedUnion("type", [
  z.object({
    ...base,
    type: z.literal("hero"),
    headline: shortText(200),
    subheadline: z.string().trim().max(600),
    imageUrl: salesPageImageUrlSchema.optional(),
    ctaLabel: shortText(80),
  }).strict(),
  z.object({
    ...base,
    type: z.literal("richText"),
    content: shortText(10_000).refine(
      value => !/<\/?[a-z][^>]*>/i.test(value),
      "Rich text accepts safe plain text/paragraph content only; raw HTML is not allowed",
    ),
  }).strict(),
  z.object({
    ...base,
    type: z.literal("image"),
    url: salesPageImageUrlSchema,
    alt: shortText(300),
    caption: optionalText(500),
  }).strict(),
  z.object({
    ...base,
    type: z.literal("benefits"),
    headline: shortText(200),
    items: z.array(shortText(500)).min(1).max(8),
  }).strict(),
  z.object({
    ...base,
    type: z.literal("offer"),
    headline: shortText(200),
    priceLabel: optionalText(100),
    buttonLabel: shortText(80),
  }).strict(),
  z.object({
    ...base,
    type: z.literal("faq"),
    items: z.array(z.object({
      question: shortText(300),
      answer: shortText(2_000),
    }).strict()).min(1).max(8),
  }).strict(),
]);

export const salesPageBlocksSchema = z.array(salesPageBlockSchema).max(30)
  .superRefine((blocks, context) => {
    const ids = new Set<string>();
    blocks.forEach((block, index) => {
      if (ids.has(block.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "id"],
          message: "Block IDs must be unique and stable",
        });
      }
      ids.add(block.id);
    });
  });

export type SalesPageBlock = z.infer<typeof salesPageBlockSchema>;

export function validatePublishableBlocks(blocks: unknown): SalesPageBlock[] {
  const parsed = salesPageBlocksSchema.parse(blocks);
  if (parsed.filter(block => block.enabled && block.type === "offer").length !== 1) {
    throw new Error("Publishing requires exactly one enabled offer block");
  }
  return parsed;
}

export function normalizeSalesPageSlug(value: string): string {
  return value.trim().toLowerCase()
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export const salesPageSlugSchema = z.string().max(200).transform(normalizeSalesPageSlug)
  .pipe(z.string().min(3).max(80).regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Slug must normalize to 3-80 lowercase URL-safe letters, numbers, and hyphens",
  ));

export const createSalesPageSchema = z.object({
  offerId: z.string().uuid(),
  slug: salesPageSlugSchema,
  title: shortText(200),
  blocks: salesPageBlocksSchema.default([]),
  checkoutSettings: checkoutSettingsSchema.default(DEFAULT_CHECKOUT_SETTINGS),
}).strict();

export const updateSalesPageSchema = z.object({
  version: z.number().int().positive(),
  slug: salesPageSlugSchema.optional(),
  title: shortText(200).optional(),
  blocks: salesPageBlocksSchema.optional(),
  checkoutSettings: checkoutSettingsSchema.optional(),
}).strict().refine(value => value.slug !== undefined || value.title !== undefined || value.blocks !== undefined || value.checkoutSettings !== undefined, {
  message: "At least one of title, slug, or blocks is required",
});

export const salesPageVersionSchema = z.object({
  version: z.number().int().positive(),
}).strict();

export function salesPageCanPublish(
  _webinar: { publishStatus: string },
  offer: { active: boolean },
  blocks: unknown,
): { ok: true; blocks: SalesPageBlock[] } | { ok: false; message: string } {
  if (!offer.active) return { ok: false, message: "Offer is inactive" };
  try {
    return { ok: true, blocks: validatePublishableBlocks(blocks) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Invalid sales page blocks" };
  }
}