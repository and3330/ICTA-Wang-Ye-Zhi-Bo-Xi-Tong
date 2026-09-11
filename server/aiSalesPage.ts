import crypto from "node:crypto";
import type { Express, Request, RequestHandler } from "express";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { offerSalesPages, users, webinarOffers, webinars } from "@shared/schema";
import { db } from "./db";
import { storage } from "./storage";
import { completeTrialAiCall, getActiveNoCardTrial, refundTrialAiCall, reserveTrialAiCall } from "./noCardTrial";
import { salesPageBlocksSchema, type SalesPageBlock } from "./salesPages";
import { requestAnthropicJson } from "./aiGenerator";

export const AI_SALES_PAGE_POINT_COST = 5;

const inputSchema = z.object({
  brief: z.string().trim().min(1).max(2_000),
  audience: z.string().trim().max(1_000).optional().default(""),
}).strict();

const safeAiText = (max: number, min = 1) => z.string().trim().min(min).max(max)
  .refine(value => !/<\/?[a-z][^>]*>/i.test(value), "AI copy must not contain HTML");
const generatedCopySchema = z.object({
  headline: safeAiText(200),
  subheadline: safeAiText(600, 0),
  benefitsHeadline: safeAiText(200),
  benefits: z.array(safeAiText(500)).min(1).max(8),
  offerHeadline: safeAiText(200),
  buttonLabel: safeAiText(80),
  faq: z.array(z.object({
    question: safeAiText(300),
    answer: safeAiText(2_000),
  }).strict()).min(1).max(8),
}).strict();

export type SalesPageAiProvider = (input: { system: string; prompt: string }) => Promise<string>;
let providerOverride: SalesPageAiProvider | undefined;

/** Test-only provider injection; production always uses the configured AI key. */
export function setSalesPageAiProviderForTests(provider?: SalesPageAiProvider) {
  providerOverride = provider;
}

function parseJson(value: string): unknown {
  const trimmed = value.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const json = fence ? fence[1].trim() : trimmed;
  const start = json.indexOf("{");
  const end = json.lastIndexOf("}");
  return JSON.parse(start >= 0 && end > start ? json.slice(start, end + 1) : json);
}

async function defaultProvider(input: { system: string; prompt: string }): Promise<string> {
  const output = await requestAnthropicJson(input.system, input.prompt, 2_500);
  if (!output.trim()) throw new Error("Empty AI provider response");
  return output;
}

function blockId() {
  return crypto.randomUUID();
}

function safeBlocks(copy: z.infer<typeof generatedCopySchema>, product: { name: string; amountTwd: number }): SalesPageBlock[] {
  // IDs, enabled state, price and permitted block types are all server owned.
  // No model-provided HTML, image, testimonial, URL, or identifier is used.
  return salesPageBlocksSchema.parse([
    { id: blockId(), type: "hero", enabled: true, headline: copy.headline, subheadline: copy.subheadline, ctaLabel: copy.buttonLabel },
    { id: blockId(), type: "benefits", enabled: true, headline: copy.benefitsHeadline, items: copy.benefits },
    {
      id: blockId(), type: "offer", enabled: true, headline: copy.offerHeadline,
      priceLabel: `NT$ ${product.amountTwd.toLocaleString("en-US")}`,
      buttonLabel: copy.buttonLabel, layout: "ecommerce", summary: product.name,
    },
    { id: blockId(), type: "faq", enabled: true, items: copy.faq },
  ]);
}

async function ownedDraftPage(userId: string, pageId: string) {
  const [row] = await db.select({
    page: offerSalesPages,
    offer: webinarOffers,
  }).from(offerSalesPages)
    .innerJoin(webinarOffers, eq(offerSalesPages.offerId, webinarOffers.id))
    .leftJoin(webinars, eq(webinarOffers.webinarId, webinars.id))
    .where(and(
      eq(offerSalesPages.id, pageId),
      isNull(offerSalesPages.deletedAt),
      sql`COALESCE(${offerSalesPages.userId}, ${webinarOffers.userId}, ${webinars.userId}) = ${userId}`,
    ))
    .limit(1);
  return row;
}

function prompts(pageTitle: string, product: { name: string; amountTwd: number }, input: z.infer<typeof inputSchema>) {
  const system = [
    "你是繁體中文電商銷售頁文案助手。",
    "只根據提供的產品事實與使用者 brief 寫清楚、可驗證的文案；不得捏造價格、折扣、保證、限時、見證、客戶、統計、效果或功能。",
    "不得輸出 HTML、Markdown、圖片網址、影片網址、推薦語或任何識別碼。",
    "只輸出 JSON，格式為：",
    '{"headline":"...","subheadline":"...","benefitsHeadline":"...","benefits":["..."],"offerHeadline":"...","buttonLabel":"...","faq":[{"question":"...","answer":"..."}]}',
  ].join("\n");
  const prompt = JSON.stringify({
    salesPageTitle: pageTitle,
    product: { name: product.name, priceTwd: product.amountTwd },
    brief: input.brief,
    audience: input.audience || null,
  });
  return { system, prompt };
}

export function registerAiSalesPageRoutes(app: Express, requireAdmin: RequestHandler) {
  app.post("/api/product-sales-pages/:pageId/ai-draft", requireAdmin, async (req: Request & { session: { userId?: string } }, res) => {
    let input: z.infer<typeof inputSchema>;
    try {
      input = inputSchema.parse(req.body);
    } catch (error: any) {
      return res.status(400).json({ message: error.message });
    }
    const userId = req.session.userId!;
    const page = await ownedDraftPage(userId, String(req.params.pageId));
    if (!page) return res.status(404).json({ message: "Sales page not found" });
    if (!page.offer.active || page.offer.ecpayAmountTwd === null) {
      return res.status(409).json({ message: "Linked product is unavailable" });
    }

    const user = await storage.getUser(userId);
    if (!user) return res.status(401).json({ message: "Unauthorized" });
    const unlimited = user.isSuperAdmin || user.subscriptionPlan === "enterprise";
    const activeTrial = !unlimited ? await getActiveNoCardTrial(userId) : null;
    const trialReservation = activeTrial ? await reserveTrialAiCall(userId) : null;
    const paidReservation = !unlimited && !activeTrial
      ? await storage.reserveAiCredits(userId, AI_SALES_PAGE_POINT_COST)
      : null;
    if (activeTrial && !trialReservation) {
      return res.status(402).json({ message: "試用期 AI 額度已用完", code: "TRIAL_AI_LIMIT_REACHED" });
    }
    if (!unlimited && !activeTrial && !paidReservation) {
      return res.status(402).json({ message: `AI 點數不足，本次生成需要 ${AI_SALES_PAGE_POINT_COST} 點`, code: "AI_POINTS_REQUIRED" });
    }

    try {
      const product = { name: page.offer.ecpayItemName || page.page.title, amountTwd: page.offer.ecpayAmountTwd };
      const prompt = prompts(page.page.title, product, input);
      const raw = await (providerOverride || defaultProvider)(prompt);
      const copy = generatedCopySchema.parse(parseJson(raw));
      const blocks = safeBlocks(copy, product);
      if (trialReservation && !await completeTrialAiCall(trialReservation.reservationId)) {
        throw new Error("Trial AI reservation is not active");
      }
      if (paidReservation) await storage.finalizeAiCreditReservation(paidReservation.reservationId);
      return res.json({
        blocks,
        cost: unlimited
          ? { kind: "unlimited", amount: 0, remaining: null }
          : trialReservation
            ? { kind: "trial_call", amount: 1, remaining: trialReservation.remaining }
            : { kind: "ai_points", amount: AI_SALES_PAGE_POINT_COST, remaining: paidReservation!.remaining },
      });
    } catch (error: any) {
      if (trialReservation) await refundTrialAiCall(trialReservation.reservationId);
      if (paidReservation) await storage.refundAiCreditReservation(paidReservation.reservationId);
      return res.status(502).json({ message: "AI 銷售頁草稿生成失敗，請稍後再試（未扣點）" });
    }
  });
}