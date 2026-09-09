import { z } from "zod";
import {
  canonicalLandingVideoSchema,
  landingVideoProviderSchema,
  type WebinarLandingBlock,
  type WebinarLandingRichNode,
} from "@shared/webinarLanding";

const text = (max: number) => z.string().trim().min(1).max(max)
  .refine(value => !/<\/?[a-z][^>]*>/i.test(value), "只允許純文字，不允許 HTML");
const optionalText = (max: number) => z.string().trim().max(max)
  .refine(value => !/<\/?[a-z][^>]*>/i.test(value), "只允許純文字，不允許 HTML").optional();
export const landingImageUrlSchema = z.string().trim().min(1).max(2048).refine(value => {
  if (/^\/uploads\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) return true;
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}, "圖片只允許 HTTPS 或 /uploads/檔名");
const landingLinkUrlSchema = z.string().trim().min(1).max(2048).refine(value => {
  if (/^\/(?!\/)[^\\\s]*$/.test(value)) return !value.includes("..");
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}, "連結只允許 HTTPS 或安全的相對路徑");

const richMarkSchema = z.union([
  z.object({ type: z.literal("bold") }).strict(),
  z.object({ type: z.literal("italic") }).strict(),
  z.object({ type: z.literal("strike") }).strict(),
  z.object({ type: z.literal("link"), attrs: z.object({ href: landingLinkUrlSchema }).strict() }).strict(),
]);
type RichNode = WebinarLandingRichNode;
const richNodeSchema: z.ZodType<RichNode> = z.lazy(() => z.union([
  z.object({ type: z.literal("doc"), content: z.array(richNodeSchema).max(200) }).strict(),
  z.object({ type: z.literal("paragraph"), content: z.array(richNodeSchema).max(100).optional() }).strict(),
  z.object({ type: z.literal("heading"), attrs: z.object({ level: z.union([z.literal(2), z.literal(3)]) }).strict(), content: z.array(richNodeSchema).max(100).optional() }).strict(),
  z.object({ type: z.literal("bulletList"), content: z.array(richNodeSchema).min(1).max(50) }).strict(),
  z.object({ type: z.literal("orderedList"), content: z.array(richNodeSchema).min(1).max(50) }).strict(),
  z.object({ type: z.literal("listItem"), content: z.array(richNodeSchema).min(1).max(20) }).strict(),
  z.object({ type: z.literal("hardBreak") }).strict(),
  z.object({ type: z.literal("text"), text: z.string().min(1).max(2000), marks: z.array(richMarkSchema).max(4).optional() }).strict(),
  z.object({ type: z.literal("image"), attrs: z.object({ src: landingImageUrlSchema, alt: z.string().max(300).optional(), title: z.string().max(300).optional() }).strict() }).strict(),
])) as z.ZodType<RichNode>;
export const richTextBodySchema = richNodeSchema.superRefine((root, ctx) => {
  let nodes = 0, textLength = 0, images = 0, depth = 0;
  const walk = (node: RichNode, level: number) => {
    nodes++; depth = Math.max(depth, level);
    if (node.type === "text") textLength += node.text?.length || 0;
    if (node.type === "image") images++;
    if (node.content) node.content.forEach(child => walk(child, level + 1));
  };
  walk(root, 1);
  if (root.type !== "doc") ctx.addIssue({ code: z.ZodIssueCode.custom, message: "內容根節點必須是 doc" });
  if (nodes > 500) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "內容節點過多" });
  if (depth > 12) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "內容巢狀過深" });
  if (textLength > 30000) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "文字內容過長" });
  if (images > 20) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "圖片數量過多" });
});

const base = { id: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/), enabled: z.boolean() };
export const webinarLandingBlockSchema = z.discriminatedUnion("type", [
  z.object({ id: base.id, type: z.literal("hero"), enabled: z.literal(true), headline: text(200), subheadline: optionalText(600), imageUrl: landingImageUrlSchema.optional(), ctaLabel: text(80) }).strict(),
  z.object({ ...base, type: z.literal("intro"), headline: text(200), content: text(3000) }).strict(),
  z.object({ ...base, type: z.literal("audience"), headline: text(200), items: z.array(text(500)).min(1).max(12) }).strict(),
  z.object({ ...base, type: z.literal("agenda"), headline: text(200), items: z.array(text(500)).min(1).max(20) }).strict(),
  z.object({ ...base, type: z.literal("instructor"), headline: text(200), name: text(120), bio: text(2000), imageUrl: landingImageUrlSchema.optional() }).strict(),
  z.object({ ...base, type: z.literal("faq"), items: z.array(z.object({ question: text(300), answer: text(2000) }).strict()).min(1).max(20) }).strict(),
  z.object({ ...base, type: z.literal("countdown"), headline: text(200) }).strict(),
  z.object({ ...base, type: z.literal("cta"), headline: text(200), ctaLabel: text(80) }).strict(),
  z.object({ ...base, type: z.literal("richText"), body: richTextBodySchema }).strict(),
  z.object({
    ...base,
    type: z.literal("stickyCta"),
    headline: text(200),
    ctaLabel: text(80),
    countdownMode: z.enum(["webinarStart", "fixed"]),
    targetAt: z.string().datetime({ offset: true }).optional(),
  }).strict(),
  z.object({
    ...base,
    type: z.literal("video"),
    provider: landingVideoProviderSchema,
    videoId: z.string(),
    headline: optionalText(200),
  }).strict(),
]);
export const webinarLandingBlocksSchema = z.array(webinarLandingBlockSchema).max(40).superRefine((blocks, ctx) => {
  const ids = new Set<string>();
  blocks.forEach((block, index) => {
    if (ids.has(block.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, "id"], message: "區塊 ID 不可重複" });
    ids.add(block.id);
  });
  const heroes = blocks.filter(block => block.type === "hero");
  if (heroes.length !== 1) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "頁面必須且只能有一個 Banner" });
  else if (blocks[0]?.type !== "hero") ctx.addIssue({ code: z.ZodIssueCode.custom, path: [0], message: "Banner 必須固定在第一個區塊" });
  if (blocks.filter(block => block.type === "stickyCta").length > 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "頁面最多只能有一個固定報名按鈕" });
  }
  blocks.forEach((block, index) => {
    if (block.type === "stickyCta") {
      if (block.countdownMode === "fixed" && block.targetAt === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, "targetAt"], message: "固定倒數必須指定目標時間" });
      }
      if (block.countdownMode === "webinarStart" && block.targetAt !== undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, "targetAt"], message: "說明會開始倒數不可指定固定目標時間" });
      }
    }
    if (block.type === "video") {
      const parsed = canonicalLandingVideoSchema.safeParse({ provider: block.provider, videoId: block.videoId });
      if (!parsed.success) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, "videoId"], message: "影片 ID 格式錯誤" });
      }
    }
  });
}) as z.ZodType<WebinarLandingBlock[]>;
export const webinarLandingBrandSchema = z.object({
  primaryColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "品牌色格式錯誤"),
  secondaryColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "強調色格式錯誤"),
  backgroundColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "背景色格式錯誤"),
}).strict();
export const createWebinarLandingPageSchema = z.object({
  title: text(200), blocks: webinarLandingBlocksSchema, brandSettings: webinarLandingBrandSchema,
}).strict();
export const updateWebinarLandingPageSchema = z.object({
  version: z.number().int().positive(),
  title: text(200).optional(), blocks: webinarLandingBlocksSchema.optional(), brandSettings: webinarLandingBrandSchema.optional(),
}).strict().refine(value => value.title !== undefined || value.blocks !== undefined || value.brandSettings !== undefined, { message: "至少需要修改一項內容" });
export const webinarLandingVersionSchema = z.object({ version: z.number().int().positive() }).strict();
export type { WebinarLandingBlock } from "@shared/webinarLanding";
export const DEFAULT_WEBINAR_LANDING_BRAND = { primaryColor: "#0f766e", secondaryColor: "#f59e0b", backgroundColor: "#ffffff" };
export function webinarLandingPageCanPublish(webinar: { publishStatus: string }, blocks: unknown) {
  if (webinar.publishStatus !== "published") return { ok: false as const, message: "請先發布說明會，才能發布落地頁" };
  try {
    return { ok: true as const, blocks: webinarLandingBlocksSchema.parse(blocks) };
  } catch (error) {
    return { ok: false as const, message: error instanceof Error ? error.message : "落地頁區塊格式錯誤" };
  }
}
export function defaultWebinarLandingTemplate(webinar: { title: string; description?: string | null }): WebinarLandingBlock[] {
  return [
    { id: "hero", type: "hero", enabled: true, headline: webinar.title, subheadline: "一場為你準備的線上分享，立即加入並掌握重點。", ctaLabel: "立即免費報名" },
    { id: "intro", type: "intro", enabled: true, headline: "你將在這場分享中獲得什麼？", content: webinar.description?.trim() || "透過清楚的步驟與實用內容，帶你建立可立即應用的行動方案。" },
    { id: "audience", type: "audience", enabled: true, headline: "適合這些參與者", items: ["想快速掌握核心觀念的你", "正在尋找可執行方法的你", "希望與同樣關心主題的人交流的你"] },
    { id: "agenda", type: "agenda", enabled: true, headline: "活動內容大綱", items: ["核心觀念與關鍵策略", "實例拆解與應用", "問答與下一步"] },
    { id: "instructor", type: "instructor", enabled: true, headline: "講師介紹", name: "主講人", bio: "專注於分享實用經驗，陪你把想法轉化為成果。" },
    { id: "faq", type: "faq", enabled: true, items: [{ question: "需要付費嗎？", answer: "本活動報名方式與費用以報名表單顯示為準。" }, { question: "報名後如何參加？", answer: "完成報名後，你會收到活動資訊與參加方式。" }] },
    { id: "countdown", type: "countdown", enabled: true, headline: "活動即將開始" },
    { id: "richText", type: "richText", enabled: true, body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "補充活動資訊與圖片" }] }] } },
    { id: "cta", type: "cta", enabled: true, headline: "現在就保留你的席次", ctaLabel: "前往報名" },
    { id: "stickyCta", type: "stickyCta", enabled: true, headline: "現在就保留你的席次", ctaLabel: "立即免費報名", countdownMode: "webinarStart" },
  ];
}