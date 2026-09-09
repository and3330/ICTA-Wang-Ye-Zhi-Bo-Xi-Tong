import { z } from "zod";

const text = (max: number) => z.string().trim().min(1).max(max)
  .refine(value => !/<\/?[a-z][^>]*>/i.test(value), "只允許純文字，不允許 HTML");
const optionalText = (max: number) => z.string().trim().max(max)
  .refine(value => !/<\/?[a-z][^>]*>/i.test(value), "只允許純文字，不允許 HTML").optional();
export const landingImageUrlSchema = z.string().trim().min(1).max(2048).refine(value => {
  if (/^\/uploads\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) return true;
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}, "圖片只允許 HTTPS 或 /uploads/檔名");

const base = { id: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/), enabled: z.boolean() };
export const webinarLandingBlockSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("hero"), headline: text(200), subheadline: optionalText(600), imageUrl: landingImageUrlSchema.optional(), ctaLabel: text(80) }).strict(),
  z.object({ ...base, type: z.literal("intro"), headline: text(200), content: text(3000) }).strict(),
  z.object({ ...base, type: z.literal("audience"), headline: text(200), items: z.array(text(500)).min(1).max(12) }).strict(),
  z.object({ ...base, type: z.literal("agenda"), headline: text(200), items: z.array(text(500)).min(1).max(20) }).strict(),
  z.object({ ...base, type: z.literal("instructor"), headline: text(200), name: text(120), bio: text(2000), imageUrl: landingImageUrlSchema.optional() }).strict(),
  z.object({ ...base, type: z.literal("faq"), items: z.array(z.object({ question: text(300), answer: text(2000) }).strict()).min(1).max(20) }).strict(),
  z.object({ ...base, type: z.literal("countdown"), headline: text(200) }).strict(),
  z.object({ ...base, type: z.literal("cta"), headline: text(200), ctaLabel: text(80) }).strict(),
]);
export const webinarLandingBlocksSchema = z.array(webinarLandingBlockSchema).max(40).superRefine((blocks, ctx) => {
  const ids = new Set<string>();
  blocks.forEach((block, index) => {
    if (ids.has(block.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, "id"], message: "區塊 ID 不可重複" });
    ids.add(block.id);
  });
});
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
export type WebinarLandingBlock = z.infer<typeof webinarLandingBlockSchema>;
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
    { id: "cta", type: "cta", enabled: true, headline: "現在就保留你的席次", ctaLabel: "前往報名" },
  ];
}