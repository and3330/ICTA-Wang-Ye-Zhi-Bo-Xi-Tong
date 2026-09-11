import crypto from "node:crypto";
import type { Express, Request, RequestHandler } from "express";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  analyticsVisitorTokenSchema,
  ctaButtons,
  ecpayConnections,
  offerSalesPages,
  users,
  webinars,
  webinarFunnelEvents,
  webinarOffers,
  webinarPayments,
  type OfferSalesPage,
  type WebinarOffer,
} from "@shared/schema";
import { db } from "./db";
import {
  createCheckMacValue,
  decryptEcpayCredential,
  ecpayActionUrl,
  merchantTradeDate,
  merchantTradeNo,
} from "./ecpay";
import { appBaseUrl } from "./mail";
import {
  createSalesPageSchema,
  normalizeCheckoutSettings,
  salesPageSlugSchema,
  salesPageVersionSchema,
  updateSalesPageSchema,
  validatePublishableBlocks,
} from "./salesPages";
import { getUncachableStripeClient } from "./stripeClient";
import { activePublishingOverride } from "./adminManagementRoutes";
import { activeMemberManualPlan } from "./manualPlanEntitlements";
import { safeRequestMetadata, sha256 } from "./funnelAnalytics";
import { appendMemberOrderEvent } from "./memberOrders";
import {
  assertTrialCommercePublication,
  createTrialCommerceSalesPage,
  hasActiveNoCardTrial,
  hasPaidOrManualCommerceEntitlement,
  isLeadCaptureOnlyTrialCommercePage,
  registerTrialCommerceRoutes,
  TrialCommerceLimitError,
} from "./trialCommerce";

type SessionRequest = Request & { session: { userId?: string } };

const productCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  amountTwd: z.number().int().min(1).max(9_999_999),
}).strict();

const productUpdateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  amountTwd: z.number().int().min(1).max(9_999_999).optional(),
  active: z.boolean().optional(),
}).strict().refine(value => Object.keys(value).length > 0, "At least one field is required");

const productCheckoutSchema = z.object({
  salesPageId: z.string().uuid(),
  buyer: z.object({
    name: z.string().trim().min(1).max(200),
    email: z.string().trim().email().max(320).transform(value => value.toLowerCase()),
  }).strict(),
  visitorToken: analyticsVisitorTokenSchema.optional(),
  sessionId: z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9_-]+$/).optional(),
  sourceCtaId: z.string().uuid().optional(),
  sourceWebinarId: z.string().uuid().optional(),
}).strict().superRefine((value, context) => {
  if (Boolean(value.sourceCtaId) !== Boolean(value.sourceWebinarId)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sourceCtaId"],
      message: "sourceCtaId and sourceWebinarId must be provided together",
    });
  }
});

const productEventSchema = z.object({
  eventType: z.literal("landing_view"),
  pageId: z.string().uuid(),
  visitorToken: analyticsVisitorTokenSchema,
  dedupeKey: z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9_.:-]+$/),
  sourceCtaId: z.string().uuid().optional(),
  sourceWebinarId: z.string().uuid().optional(),
}).strict().superRefine((value, context) => {
  if (Boolean(value.sourceCtaId) !== Boolean(value.sourceWebinarId)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sourceCtaId"],
      message: "sourceCtaId and sourceWebinarId must be provided together",
    });
  }
});

function statusToken() {
  return crypto.randomBytes(24).toString("base64url");
}

function statusTokenHash(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function storedEntitlement(user: typeof users.$inferSelect | undefined): Promise<boolean> {
  if (!user?.isActive) return false;
  if (user.isSuperAdmin || user.subscriptionPlan === "enterprise") return true;
  if (["active", "trialing"].includes(user.subscriptionStatus)
    && (!user.planExpiresAt || user.planExpiresAt.getTime() > Date.now())) return true;
  // Time-limited overrides and manual plans admit public sales pages, but
  // neither mutates Stripe subscription truth nor grants AI credits.
  return Boolean(await activeMemberManualPlan(user.id) || await activePublishingOverride(user.id));
}

function effectiveOwner(
  row: { userId: string | null; webinarUserId?: string | null },
): string | null {
  return row.userId || row.webinarUserId || null;
}

async function ownedOffer(userId: string, offerId: string): Promise<WebinarOffer | undefined> {
  const [row] = await db.select({ offer: webinarOffers, webinarUserId: webinars.userId })
    .from(webinarOffers)
    .leftJoin(webinars, eq(webinarOffers.webinarId, webinars.id))
    .where(and(
      eq(webinarOffers.id, offerId),
      sql`COALESCE(${webinarOffers.userId}, ${webinars.userId}) = ${userId}`,
    ))
    .limit(1);
  return row?.offer;
}

async function ownedPage(userId: string, pageId: string): Promise<OfferSalesPage | undefined> {
  const [row] = await db.select({ page: offerSalesPages })
    .from(offerSalesPages)
    .where(and(
      eq(offerSalesPages.id, pageId),
      isNull(offerSalesPages.deletedAt),
      sql`COALESCE(
        ${offerSalesPages.userId},
        (SELECT ${webinarOffers.userId} FROM ${webinarOffers} WHERE ${webinarOffers.id} = ${offerSalesPages.offerId}),
        (SELECT ${webinars.userId} FROM ${webinars} WHERE ${webinars.id} = ${offerSalesPages.webinarId})
      ) = ${userId}`,
    ))
    .limit(1);
  return row?.page;
}

async function publicProductContext(offerId: string, pageId: string) {
  const [row] = await db.select({
    offer: webinarOffers,
    page: offerSalesPages,
    offerWebinarUserId: webinars.userId,
  })
    .from(offerSalesPages)
    .innerJoin(webinarOffers, eq(offerSalesPages.offerId, webinarOffers.id))
    .leftJoin(webinars, eq(webinarOffers.webinarId, webinars.id))
    .where(and(
      eq(webinarOffers.id, offerId),
      eq(offerSalesPages.id, pageId),
      eq(offerSalesPages.offerId, offerId),
      eq(offerSalesPages.status, "published"),
      eq(webinarOffers.active, true),
      isNull(offerSalesPages.deletedAt),
    ))
    .limit(1);
  if (!row) return undefined;
  const ownerId = effectiveOwner({ userId: row.offer.userId, webinarUserId: row.offerWebinarUserId });
  if (!ownerId || (row.page.userId && row.page.userId !== ownerId)) return undefined;
  const [owner] = await db.select().from(users).where(eq(users.id, ownerId)).limit(1);
  return await storedEntitlement(owner) ? { ...row, owner, ownerId } : undefined;
}

async function validatedSource(input: {
  sourceCtaId?: string;
  sourceWebinarId?: string;
  ownerId: string;
  offerId: string;
  salesPageId: string;
}) {
  if (!input.sourceCtaId || !input.sourceWebinarId) return undefined;
  const [row] = await db.select({ cta: ctaButtons, webinar: webinars })
    .from(ctaButtons)
    .innerJoin(webinars, eq(ctaButtons.webinarId, webinars.id))
    .where(and(
      eq(ctaButtons.id, input.sourceCtaId),
      eq(ctaButtons.webinarId, input.sourceWebinarId),
      eq(webinars.userId, input.ownerId),
      eq(webinars.publishStatus, "published"),
      isNull(webinars.deletedAt),
      isNull(ctaButtons.archivedAt),
      or(eq(ctaButtons.liveOnly, false), sql`${ctaButtons.expiresAt} > now()`),
    ))
    .limit(1);
  const cta = row?.cta;
  const matchesPage = cta?.salesPageId === input.salesPageId && !cta.offerId && !cta.url;
  const matchesOffer = cta?.offerId === input.offerId && !cta.salesPageId && !cta.url;
  return cta && (matchesPage || matchesOffer) ? cta : undefined;
}

async function offerPresentation(offer: WebinarOffer, salesPage?: OfferSalesPage) {
  let name = offer.ecpayItemName;
  let amountMinor: number | null = offer.ecpayAmountTwd === null ? null : offer.ecpayAmountTwd * 100;
  let currency = "TWD";
  if (offer.paymentProvider === "stripe") {
    const stripe = await getUncachableStripeClient();
    const [product, price] = await Promise.all([
      stripe.products.retrieve(offer.stripeProductId!),
      stripe.prices.retrieve(offer.stripePriceId!),
    ]);
    name = "deleted" in product ? "Unavailable product" : product.name;
    amountMinor = price.unit_amount;
    currency = price.currency.toUpperCase();
  }
  return {
    id: offer.id,
    name,
    amountMinor,
    currency,
    paymentProvider: offer.paymentProvider,
    ecpayItemName: offer.ecpayItemName,
    ecpayAmountTwd: offer.ecpayAmountTwd,
    active: offer.active,
    webinarId: offer.webinarId,
    ...(salesPage ? { salesPage } : {}),
  };
}

async function sendEcpayCheckout(
  res: any,
  context: Awaited<ReturnType<typeof publicProductContext>> & {},
  input: z.infer<typeof productCheckoutSchema>,
  source: Awaited<ReturnType<typeof validatedSource>>,
) {
  const { offer, page, ownerId } = context;
  if (offer.paymentProvider !== "ecpay" || !offer.ecpayItemName || !offer.ecpayAmountTwd) {
    return res.status(409).json({ message: "Product checkout is available through ECPay only" });
  }
  const [connection] = await db.select().from(ecpayConnections).where(and(
    eq(ecpayConnections.userId, ownerId),
    eq(ecpayConnections.enabled, true),
  )).limit(1);
  if (!connection) return res.status(409).json({ message: "ECPay checkout is unavailable" });

  const tradeNo = merchantTradeNo();
  const token = statusToken();
  const checkoutSettings = normalizeCheckoutSettings(page.publishedCheckoutSettings);
  const backUrl = `${appBaseUrl()}/purchase-result?p=e&t=${token}`;
  if (backUrl.length > 200) {
    return res.status(409).json({ message: "ECPay return URL exceeds the provider limit" });
  }
  const visitorTokenHash = input.visitorToken ? sha256(input.visitorToken) : null;
  const [payment] = await db.insert(webinarPayments).values({
    userId: ownerId,
    webinarId: input.sourceWebinarId || null,
    offerId: offer.id,
    ctaId: source?.id || null,
    visitorTokenHash,
    paymentProvider: "ecpay",
    providerOrderId: tradeNo,
    checkoutStatusTokenHash: statusTokenHash(token),
    salesPageId: page.id,
    originSalesPageIdSnapshot: page.id,
    salesPageVersion: page.version,
    checkoutSettingsSnapshot: checkoutSettings,
    offerSlugSnapshot: page.slug,
    ecpayConnectionId: connection.id,
    merchantIdSnapshot: connection.merchantId,
    providerEnvironment: connection.environment,
    providerHashKeySnapshot: connection.hashKeyEncrypted,
    providerHashIvSnapshot: connection.hashIvEncrypted,
    productNameSnapshot: offer.ecpayItemName,
    buyerNameSnapshot: input.buyer.name,
    buyerEmailSnapshot: input.buyer.email,
    providerStatus: "checkout_started",
    providerStatusMessage: "Awaiting payment confirmation",
    amountMinor: offer.ecpayAmountTwd * 100,
    currency: "TWD",
    status: "pending",
  }).returning({ id: webinarPayments.id });
  await appendMemberOrderEvent(db, {
    paymentId: payment.id,
    type: "checkout_started",
    details: { provider: "ecpay" },
  });

  const fields: Record<string, string | number> = {
    MerchantID: connection.merchantId,
    MerchantTradeNo: tradeNo,
    MerchantTradeDate: merchantTradeDate(),
    PaymentType: "aio",
    TotalAmount: offer.ecpayAmountTwd,
    TradeDesc: "Product order",
    ItemName: offer.ecpayItemName.replace(/[<>&#]/g, " ").slice(0, 200),
    ReturnURL: `${appBaseUrl()}/api/ecpay/return`,
    ClientBackURL: backUrl,
    ChoosePayment: "ALL",
    EncryptType: "1",
  };
  fields.CheckMacValue = createCheckMacValue(
    fields,
    decryptEcpayCredential(connection.hashKeyEncrypted),
    decryptEcpayCredential(connection.hashIvEncrypted),
  );
  await db.insert(webinarFunnelEvents).values({
    userId: ownerId,
    webinarId: input.sourceWebinarId || null,
    eventType: "checkout_start",
    sessionId: input.sessionId,
    ctaId: source?.id,
    ctaKey: source?.ctaKey,
    offerId: offer.id,
    salesPageId: page.id,
    visitorTokenHash,
    dedupeKey: sha256(`checkout:ecpay:${tradeNo}`),
    metadata: { serverRecorded: true },
  });
  return res.json({
    provider: "ecpay",
    action: ecpayActionUrl(connection.environment as "stage" | "production"),
    fields,
  });
}

export function productSalesPageTargetUrl(webinarId: string, ctaId: string): string {
  return `/api/webinars/${encodeURIComponent(webinarId)}/ctas/${encodeURIComponent(ctaId)}/target`;
}

export function registerProductCommerceRoutes(
  app: Express,
  requireAdmin: (req: any, res: any, next: any) => void,
  eventRateLimit: (req: any, res: any, next: any) => void,
  checkoutRateLimit: (req: any, res: any, next: any) => void,
  withMediaReferenceLock: (handler: RequestHandler) => RequestHandler,
  verifyReferencedMediaUrls: (payload: unknown) => Promise<void>,
) {
  app.get("/api/products", requireAdmin, async (req: SessionRequest, res) => {
    try {
      const userId = req.session.userId!;
      const rows = await db.select({ offer: webinarOffers, webinarUserId: webinars.userId })
        .from(webinarOffers)
        .leftJoin(webinars, eq(webinarOffers.webinarId, webinars.id))
        .where(sql`COALESCE(${webinarOffers.userId}, ${webinars.userId}) = ${userId}`)
        .orderBy(desc(webinarOffers.createdAt));
      const pages = await db.select().from(offerSalesPages).where(and(
        sql`COALESCE(
          ${offerSalesPages.userId},
          (SELECT ${webinarOffers.userId} FROM ${webinarOffers} WHERE ${webinarOffers.id} = ${offerSalesPages.offerId}),
          (SELECT ${webinars.userId} FROM ${webinars} WHERE ${webinars.id} = ${offerSalesPages.webinarId})
        ) = ${userId}`,
        isNull(offerSalesPages.deletedAt),
      ));
      const byOffer = new Map(pages.map(page => [page.offerId, page]));
      res.json(await Promise.all(rows.map(row => offerPresentation(row.offer, byOffer.get(row.offer.id)))));
    } catch (error: any) {
      res.status(502).json({ message: error.message });
    }
  });

  app.post("/api/products", requireAdmin, async (req: SessionRequest, res) => {
    try {
      const input = productCreateSchema.parse(req.body);
      const [offer] = await db.insert(webinarOffers).values({
        userId: req.session.userId!,
        webinarId: null,
        paymentProvider: "ecpay",
        ecpayItemName: input.name,
        ecpayAmountTwd: input.amountTwd,
        checkoutMode: "payment",
      }).returning();
      res.status(201).json(await offerPresentation(offer));
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/products/:offerId", requireAdmin, async (req: SessionRequest, res) => {
    try {
      const input = productUpdateSchema.parse(req.body);
      const offer = await ownedOffer(req.session.userId!, String(req.params.offerId));
      if (!offer) return res.status(404).json({ message: "Product not found" });
      if (offer.paymentProvider !== "ecpay" && (input.name !== undefined || input.amountTwd !== undefined)) {
        return res.status(409).json({ message: "Historical Stripe products cannot be edited here" });
      }
      const [updated] = await db.update(webinarOffers).set({
        userId: req.session.userId!,
        ...(input.name !== undefined ? { ecpayItemName: input.name } : {}),
        ...(input.amountTwd !== undefined ? { ecpayAmountTwd: input.amountTwd } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      }).where(and(
        eq(webinarOffers.id, offer.id),
        sql`COALESCE(
          ${webinarOffers.userId},
          (SELECT ${webinars.userId} FROM ${webinars} WHERE ${webinars.id} = ${webinarOffers.webinarId})
        ) = ${req.session.userId!}`,
      )).returning();
      if (!updated) return res.status(409).json({ message: "Product owner could not be resolved" });
      res.json(await offerPresentation(updated));
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/products/:offerId", requireAdmin, async (req: SessionRequest, res) => {
    const offer = await ownedOffer(req.session.userId!, String(req.params.offerId));
    if (!offer) return res.status(404).json({ message: "Product not found" });
    const [updated] = await db.update(webinarOffers).set({ active: false, userId: req.session.userId! })
      .where(and(
        eq(webinarOffers.id, offer.id),
        sql`COALESCE(
          ${webinarOffers.userId},
          (SELECT ${webinars.userId} FROM ${webinars} WHERE ${webinars.id} = ${webinarOffers.webinarId})
        ) = ${req.session.userId!}`,
      )).returning();
    if (!updated) return res.status(409).json({ message: "Product owner could not be resolved" });
    res.json(await offerPresentation(updated));
  });

  app.get("/api/products/:offerId/orders", requireAdmin, async (req: SessionRequest, res) => {
    const offer = await ownedOffer(req.session.userId!, String(req.params.offerId));
    if (!offer) return res.status(404).json({ message: "Product not found" });
    const orders = await db.select({
      id: webinarPayments.id,
      amountMinor: webinarPayments.amountMinor,
      currency: webinarPayments.currency,
      status: webinarPayments.status,
      createdAt: webinarPayments.createdAt,
      purchasedAt: webinarPayments.purchasedAt,
      webinarId: webinarPayments.webinarId,
    }).from(webinarPayments).where(and(
      eq(webinarPayments.offerId, offer.id),
      or(eq(webinarPayments.userId, req.session.userId!), isNull(webinarPayments.userId)),
    )).orderBy(desc(webinarPayments.createdAt));
    res.json(orders.map(order => ({
      ...order,
      source: order.webinarId ? "webinar" as const : "direct" as const,
    })));
  });

  app.get("/api/product-sales-pages", requireAdmin, async (req: SessionRequest, res) => {
    try {
      const offerId = req.query.offerId === undefined ? undefined : z.string().uuid().parse(req.query.offerId);
      if (offerId && !(await ownedOffer(req.session.userId!, offerId))) {
        return res.status(404).json({ message: "Product not found" });
      }
      const conditions = [
        sql`COALESCE(
          ${offerSalesPages.userId},
          (SELECT ${webinarOffers.userId} FROM ${webinarOffers} WHERE ${webinarOffers.id} = ${offerSalesPages.offerId}),
          (SELECT ${webinars.userId} FROM ${webinars} WHERE ${webinars.id} = ${offerSalesPages.webinarId})
        ) = ${req.session.userId!}`,
        isNull(offerSalesPages.deletedAt),
        ...(offerId ? [eq(offerSalesPages.offerId, offerId)] : []),
      ];
      res.json(await db.select().from(offerSalesPages)
        .where(and(...conditions))
        .orderBy(desc(offerSalesPages.updatedAt)));
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/product-sales-pages/:pageId", requireAdmin, async (req: SessionRequest, res) => {
    const page = await ownedPage(req.session.userId!, String(req.params.pageId));
    if (!page) return res.status(404).json({ message: "Sales page not found" });
    res.json(page);
  });

  app.post("/api/product-sales-pages", requireAdmin, withMediaReferenceLock(async (req: SessionRequest, res) => {
    try {
      const input = createSalesPageSchema.parse(req.body);
      await verifyReferencedMediaUrls(input.blocks);
      const offer = await ownedOffer(req.session.userId!, input.offerId);
      if (!offer?.active) return res.status(400).json({ message: "Product is unavailable" });
       const ownerId = req.session.userId!;
       // For a no-card trial this call is still the existing sales-page editor
       // API, but page creation and the one-page ownership fence commit
       // atomically. Paid/manual commerce retains its original code path.
       const trialPage = await createTrialCommerceSalesPage(ownerId, offer, input);
       const [page] = trialPage ? [trialPage] : await db.insert(offerSalesPages).values({
         userId: ownerId,
         webinarId: offer.webinarId,
         offerId: offer.id,
         slug: input.slug,
         title: input.title,
         orderedBlocks: input.blocks,
         checkoutSettings: input.checkoutSettings,
       }).returning();
      res.status(201).json(page);
    } catch (error: any) {
       if (error instanceof TrialCommerceLimitError) return res.status(409).json({ message: error.message, code: "TRIAL_PRODUCT_PAGE_LIMIT" });
      if (error?.code === "23505") return res.status(409).json({ message: "Slug or product already has a sales page" });
      res.status(400).json({ message: error.message });
    }
  }));

  app.patch("/api/product-sales-pages/:pageId", requireAdmin, withMediaReferenceLock(async (req: SessionRequest, res) => {
    try {
      const input = updateSalesPageSchema.parse(req.body);
      if (input.blocks !== undefined) await verifyReferencedMediaUrls(input.blocks);
      const existing = await ownedPage(req.session.userId!, String(req.params.pageId));
      if (!existing) return res.status(404).json({ message: "Sales page not found" });
      if (existing.status === "published" && (
        (input.title !== undefined && input.title !== existing.title) ||
        (input.slug !== undefined && input.slug !== existing.slug)
      )) {
        return res.status(409).json({ message: "Unpublish the sales page before changing its public title or slug" });
      }
      if (existing.status === "published" && input.blocks !== undefined) validatePublishableBlocks(input.blocks);
      const [page] = await db.update(offerSalesPages).set({
        userId: req.session.userId!,
        ...(input.slug !== undefined ? { slug: input.slug } : {}),
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.blocks !== undefined ? { orderedBlocks: input.blocks } : {}),
        ...(input.checkoutSettings !== undefined ? { checkoutSettings: normalizeCheckoutSettings(input.checkoutSettings) } : {}),
        version: sql`${offerSalesPages.version} + 1`,
        updatedAt: new Date(),
      }).where(and(
        eq(offerSalesPages.id, existing.id),
        sql`COALESCE(
          ${offerSalesPages.userId},
          (SELECT ${webinarOffers.userId} FROM ${webinarOffers} WHERE ${webinarOffers.id} = ${offerSalesPages.offerId}),
          (SELECT ${webinars.userId} FROM ${webinars} WHERE ${webinars.id} = ${offerSalesPages.webinarId})
        ) = ${req.session.userId!}`,
        eq(offerSalesPages.version, input.version),
        isNull(offerSalesPages.deletedAt),
      )).returning();
      if (!page) return res.status(409).json({ message: "Version conflict", code: "VERSION_CONFLICT" });
      res.json(page);
    } catch (error: any) {
      if (error?.code === "23505") return res.status(409).json({ message: "Slug is already in use" });
      res.status(400).json({ message: error.message });
    }
  }));

  app.post("/api/product-sales-pages/:pageId/publish", requireAdmin, withMediaReferenceLock(async (req: SessionRequest, res) => {
    try {
      const input = salesPageVersionSchema.parse(req.body);
      const page = await ownedPage(req.session.userId!, String(req.params.pageId));
      if (!page) return res.status(404).json({ message: "Sales page not found" });
      const offer = await ownedOffer(req.session.userId!, page.offerId);
      if (!offer?.active || offer.paymentProvider !== "ecpay") {
        return res.status(409).json({ message: "Linked product is unavailable" });
      }
      const [owner] = await db.select().from(users).where(eq(users.id, req.session.userId!)).limit(1);
       const paidEntitlement = await hasPaidOrManualCommerceEntitlement(req.session.userId!);
       const noCardTrial = !paidEntitlement && await hasActiveNoCardTrial(req.session.userId!);
       if (noCardTrial) await assertTrialCommercePublication(req.session.userId!, page.id);
       if (!paidEntitlement && !noCardTrial && !await storedEntitlement(owner)) {
        return res.status(403).json({ message: "SUBSCRIPTION_REQUIRED", code: "SUBSCRIPTION_REQUIRED" });
      }
      await verifyReferencedMediaUrls(page.orderedBlocks);
      validatePublishableBlocks(page.orderedBlocks);
      const [published] = await db.update(offerSalesPages).set({
        userId: req.session.userId!,
        status: "published",
        publishedAt: new Date(),
        publishedOrderedBlocks: page.orderedBlocks,
        publishedCheckoutSettings: normalizeCheckoutSettings(page.checkoutSettings),
        version: sql`${offerSalesPages.version} + 1`,
        updatedAt: new Date(),
      }).where(and(
        eq(offerSalesPages.id, page.id),
        sql`COALESCE(
          ${offerSalesPages.userId},
          (SELECT ${webinarOffers.userId} FROM ${webinarOffers} WHERE ${webinarOffers.id} = ${offerSalesPages.offerId}),
          (SELECT ${webinars.userId} FROM ${webinars} WHERE ${webinars.id} = ${offerSalesPages.webinarId})
        ) = ${req.session.userId!}`,
        eq(offerSalesPages.version, input.version),
        isNull(offerSalesPages.deletedAt),
        sql`EXISTS (
          SELECT 1 FROM ${webinarOffers}
          WHERE ${webinarOffers.id} = ${offerSalesPages.offerId}
            AND COALESCE(
              ${webinarOffers.userId},
              (SELECT ${webinars.userId} FROM ${webinars} WHERE ${webinars.id} = ${webinarOffers.webinarId})
            ) = ${req.session.userId!}
            AND ${webinarOffers.active} = true
        )`,
      )).returning();
      if (!published) return res.status(409).json({ message: "Version conflict or product became unavailable", code: "VERSION_CONFLICT" });
      res.json(published);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }));

  app.post("/api/product-sales-pages/:pageId/unpublish", requireAdmin, async (req: SessionRequest, res) => {
    try {
      const input = salesPageVersionSchema.parse(req.body);
      const page = await ownedPage(req.session.userId!, String(req.params.pageId));
      if (!page) return res.status(404).json({ message: "Sales page not found" });
      const [updated] = await db.update(offerSalesPages).set({
        userId: req.session.userId!,
        status: "draft",
        publishedAt: null,
        version: sql`${offerSalesPages.version} + 1`,
        updatedAt: new Date(),
      }).where(and(
        eq(offerSalesPages.id, page.id),
        sql`COALESCE(
          ${offerSalesPages.userId},
          (SELECT ${webinarOffers.userId} FROM ${webinarOffers} WHERE ${webinarOffers.id} = ${offerSalesPages.offerId}),
          (SELECT ${webinars.userId} FROM ${webinars} WHERE ${webinars.id} = ${offerSalesPages.webinarId})
        ) = ${req.session.userId!}`,
        eq(offerSalesPages.version, input.version),
        isNull(offerSalesPages.deletedAt),
      )).returning();
      if (!updated) return res.status(409).json({ message: "Version conflict", code: "VERSION_CONFLICT" });
      res.json(updated);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/product-sales-pages/:pageId", requireAdmin, async (req: SessionRequest, res) => {
    const page = await ownedPage(req.session.userId!, String(req.params.pageId));
    if (!page) return res.status(404).json({ message: "Sales page not found" });
    await db.update(offerSalesPages).set({
      userId: req.session.userId!,
      status: "draft",
      deletedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(
      eq(offerSalesPages.id, page.id),
      sql`COALESCE(
        ${offerSalesPages.userId},
        (SELECT ${webinarOffers.userId} FROM ${webinarOffers} WHERE ${webinarOffers.id} = ${offerSalesPages.offerId}),
        (SELECT ${webinars.userId} FROM ${webinars} WHERE ${webinars.id} = ${offerSalesPages.webinarId})
      ) = ${req.session.userId!}`,
    ));
    res.json({ success: true });
  });

  app.post("/api/products/:offerId/checkout", checkoutRateLimit, async (req, res) => {
    try {
      const input = productCheckoutSchema.parse(req.body);
      if (await isLeadCaptureOnlyTrialCommercePage(req.params.offerId, input.salesPageId)) {
        return res.status(409).json({
          code: "TRIAL_LEAD_CAPTURE_ONLY",
          message: "This sales page accepts leads instead of checkout",
        });
      }
      const context = await publicProductContext(req.params.offerId, input.salesPageId);
      if (!context) return res.status(404).json({ message: "Sales page or product is unavailable" });
      const source = await validatedSource({ ...input, ownerId: context.ownerId, offerId: context.offer.id });
      if (input.sourceCtaId && !source) return res.status(400).json({ message: "Invalid CTA source attribution" });
      return sendEcpayCheckout(res, context, input, source);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.post("/api/products/:offerId/events", eventRateLimit, async (req, res) => {
    try {
      const input = productEventSchema.parse(req.body);
      if (await isLeadCaptureOnlyTrialCommercePage(req.params.offerId, input.pageId)) {
        return res.status(409).json({
          code: "TRIAL_LEAD_CAPTURE_ONLY",
          message: "Use the trial commerce view-event endpoint for this page",
        });
      }
      const context = await publicProductContext(req.params.offerId, input.pageId);
      if (!context) return res.status(404).json({ message: "Sales page or product is unavailable" });
      const source = await validatedSource({
        ...input,
        ownerId: context.ownerId,
        offerId: context.offer.id,
        salesPageId: input.pageId,
      });
      if (input.sourceCtaId && !source) return res.status(400).json({ message: "Invalid CTA source attribution" });
      const [event] = await db.insert(webinarFunnelEvents).values({
        userId: context.ownerId,
        webinarId: input.sourceWebinarId || null,
        eventType: "landing_view",
        ctaId: source?.id,
        ctaKey: source?.ctaKey,
        offerId: context.offer.id,
        salesPageId: context.page.id,
        visitorTokenHash: sha256(input.visitorToken),
        dedupeKey: sha256(`product:${context.offer.id}:landing_view:${input.dedupeKey}`),
        metadata: safeRequestMetadata({}, {
          referrer: req.get("referer"),
          userAgent: req.get("user-agent"),
          ip: req.ip || req.socket.remoteAddress,
          hashSalt: process.env.SESSION_SECRET || "product-context",
        }),
      }).onConflictDoNothing().returning();
      res.status(event ? 202 : 200).json({ accepted: true, deduplicated: !event });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/webinars/:id/ctas/:ctaId/target", async (req, res) => {
    const [row] = await db.select({ cta: ctaButtons, page: offerSalesPages, webinar: webinars, offer: webinarOffers })
      .from(ctaButtons)
      .innerJoin(webinars, eq(ctaButtons.webinarId, webinars.id))
      .innerJoin(offerSalesPages, eq(ctaButtons.salesPageId, offerSalesPages.id))
      .innerJoin(webinarOffers, eq(offerSalesPages.offerId, webinarOffers.id))
      .where(and(
        eq(ctaButtons.id, req.params.ctaId),
        eq(ctaButtons.webinarId, req.params.id),
        eq(ctaButtons.salesPageId, offerSalesPages.id),
        eq(webinars.publishStatus, "published"),
        isNull(webinars.deletedAt),
        isNull(ctaButtons.archivedAt),
        or(eq(ctaButtons.liveOnly, false), sql`${ctaButtons.expiresAt} > now()`),
        isNull(offerSalesPages.deletedAt),
        eq(offerSalesPages.status, "published"),
        eq(webinarOffers.active, true),
        sql`COALESCE(
          ${webinarOffers.userId},
          (SELECT owner_webinar.user_id FROM webinars owner_webinar WHERE owner_webinar.id = ${webinarOffers.webinarId})
        ) = ${webinars.userId}`,
        sql`COALESCE(
          ${offerSalesPages.userId},
          ${webinarOffers.userId},
          (SELECT owner_webinar.user_id FROM webinars owner_webinar WHERE owner_webinar.id = ${webinarOffers.webinarId})
        ) = ${webinars.userId}`,
      ))
      .limit(1);
    if (!row) return res.status(404).json({ message: "CTA target is unavailable" });
    const ownerId = row.offer.userId || row.webinar.userId;
    if (!ownerId) return res.status(404).json({ message: "CTA target is unavailable" });
    const [owner] = await db.select().from(users).where(eq(users.id, ownerId)).limit(1);
    if (!await storedEntitlement(owner)) return res.status(404).json({ message: "CTA target is unavailable" });
    res.redirect(302, `/sales/${encodeURIComponent(row.page.slug)}?sourceCtaId=${encodeURIComponent(row.cta.id)}&sourceWebinarId=${encodeURIComponent(row.webinar.id)}`);
  });

  registerTrialCommerceRoutes(app, requireAdmin);
}