import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { webinars } from "@shared/schema";
import {
  webinarLandingBlocksSchema, webinarLandingBrandSchema, defaultWebinarLandingTemplate,
  landingImageUrlSchema, richTextBodySchema, webinarLandingPageCanPublish,
} from "./webinarLandingPages";
import { parseLandingVideoUrl } from "@shared/webinarLanding";

test("預設模板包含完整落地頁區塊", () => {
  const blocks = defaultWebinarLandingTemplate({ title: "測試說明會", description: "介紹" });
  assert.deepEqual(blocks.map(block => block.type), ["hero", "intro", "audience", "agenda", "instructor", "faq", "countdown", "richText", "cta", "stickyCta"]);
  assert.equal(blocks.some(block => block.type === "stickyCta" && block.enabled), true);
  assert.equal(webinarLandingBlocksSchema.safeParse(blocks).success, true);
});

test("影片網址 parser 僅接受明確 allowlist 並輸出 canonical ID", () => {
  const youtubeId = "dQw4w9WgXcQ";
  const accepted = [
    [`https://www.youtube.com/watch?v=${youtubeId}&t=12`, { provider: "youtube", videoId: youtubeId }],
    [`https://youtu.be/${youtubeId}`, { provider: "youtube", videoId: youtubeId }],
    [`https://youtube.com/shorts/${youtubeId}`, { provider: "youtube", videoId: youtubeId }],
    [`https://youtube.com/embed/${youtubeId}`, { provider: "youtube", videoId: youtubeId }],
    [`https://www.youtube-nocookie.com/embed/${youtubeId}`, { provider: "youtube", videoId: youtubeId }],
    ["https://vimeo.com/123456789", { provider: "vimeo", videoId: "123456789" }],
    ["https://player.vimeo.com/video/123456789", { provider: "vimeo", videoId: "123456789" }],
  ] as const;
  for (const [url, expected] of accepted) assert.deepEqual(parseLandingVideoUrl(url), expected);

  for (const url of [
    `http://youtube.com/watch?v=${youtubeId}`,
    `https://user:pass@youtube.com/watch?v=${youtubeId}`,
    `https://youtube.com:8443/watch?v=${youtubeId}`,
    `https://youtube.com.evil.example/watch?v=${youtubeId}`,
    `https://evil.example/youtube.com/watch?v=${youtubeId}`,
    `https://youtu.be.evil.example/${youtubeId}`,
    "https://vimeo.com.evil.example/123456789",
    "https://player.vimeo.com.evil.example/video/123456789",
    "javascript:alert(1)",
  ]) {
    assert.throws(() => parseLandingVideoUrl(url), Error);
  }
});

test("sticky CTA 是 registration-only singleton 且固定倒數必須有 ISO 目標時間", () => {
  const template = defaultWebinarLandingTemplate({ title: "測試" });
  const sticky = template.find(block => block.type === "stickyCta")!;
  assert.equal(webinarLandingBlocksSchema.safeParse([...template, { ...sticky, id: "sticky2" }]).success, false);
  assert.equal(webinarLandingBlocksSchema.safeParse(template.map(block =>
    block.type === "stickyCta" ? { ...block, countdownMode: "fixed", targetAt: undefined } : block
  )).success, false);
  assert.equal(webinarLandingBlocksSchema.safeParse(template.map(block =>
    block.type === "stickyCta" ? { ...block, countdownMode: "fixed", targetAt: "2030-01-02T03:04:05Z" } : block
  )).success, true);
  assert.equal(webinarLandingBlocksSchema.safeParse(template.map(block =>
    block.type === "stickyCta" ? { ...block, countdownMode: "webinarStart", targetAt: "2030-01-02T03:04:05Z" } : block
  )).success, false);
  assert.equal(webinarLandingBlocksSchema.safeParse(template.map(block =>
    block.type === "stickyCta" ? { ...block, url: "https://example.com" } : block
  )).success, false);
});

test("video blocks require canonical provider-specific IDs", () => {
  const template = defaultWebinarLandingTemplate({ title: "測試" });
  assert.equal(webinarLandingBlocksSchema.safeParse([
    ...template,
    { id: "video", type: "video", enabled: true, provider: "youtube", videoId: "dQw4w9WgXcQ", headline: "介紹" },
  ]).success, true);
  assert.equal(webinarLandingBlocksSchema.safeParse([
    ...template,
    { id: "video", type: "video", enabled: true, provider: "youtube", videoId: "https://youtu.be/dQw4w9WgXcQ" },
  ]).success, false);
  assert.equal(webinarLandingBlocksSchema.safeParse([
    ...template,
    { id: "video", type: "video", enabled: true, provider: "vimeo", videoId: "not-numeric" },
  ]).success, false);
});

test("richText AST accepts safe content and rejects unsafe or oversized content", () => {
  const body = { type: "doc", content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Hello", marks: [{ type: "bold" }] }] },
    { type: "paragraph", content: [{ type: "text", text: "read", marks: [{ type: "link", attrs: { href: "/about" } }] }] },
    { type: "image", attrs: { src: "/uploads/hero.webp", alt: "hero" } },
  ] };
  assert.equal(richTextBodySchema.safeParse(body).success, true);
  assert.equal(richTextBodySchema.safeParse({ ...body, content: [{ type: "script", attrs: {} }] }).success, false);
  assert.equal(richTextBodySchema.safeParse({ ...body, content: [{ type: "image", attrs: { src: "javascript:alert(1)" } }] }).success, false);
  assert.equal(richTextBodySchema.safeParse({ ...body, content: [{ type: "image", attrs: { src: "http://example.com/a.png" } }] }).success, false);
  assert.equal(richTextBodySchema.safeParse({ ...body, content: [{ type: "image", attrs: { src: "/uploads/a.png", extra: "x" } }] }).success, false);
  assert.equal(richTextBodySchema.safeParse({ ...body, content: Array.from({ length: 201 }, () => ({ type: "paragraph" })) }).success, false);
});

test("hero must be unique and remain at index zero", () => {
  const template = defaultWebinarLandingTemplate({ title: "測試" });
  assert.equal(webinarLandingBlocksSchema.safeParse(template).success, true);
  assert.equal(webinarLandingBlocksSchema.safeParse([...template, template[0]]).success, false);
  assert.equal(webinarLandingBlocksSchema.safeParse([template[1], ...template.slice(1)]).success, false);
});

test("區塊純文字 schema 拒絕 HTML 與重複 ID", () => {
  const template = defaultWebinarLandingTemplate({ title: "測試" });
  assert.equal(webinarLandingBlocksSchema.safeParse([{ ...template[0], headline: "<script>alert(1)</script>" }]).success, false);
  assert.equal(webinarLandingBlocksSchema.safeParse([template[0], template[0]]).success, false);
});

test("圖片只接受 HTTPS 或安全 uploads 檔名", () => {
  assert.equal(landingImageUrlSchema.safeParse("https://example.com/banner.jpg").success, true);
  assert.equal(landingImageUrlSchema.safeParse("/uploads/banner_1.webp").success, true);
  assert.equal(landingImageUrlSchema.safeParse("http://example.com/banner.jpg").success, false);
  assert.equal(landingImageUrlSchema.safeParse("/uploads/../secret.jpg").success, false);
  assert.equal(landingImageUrlSchema.safeParse("javascript:alert(1)").success, false);
});

test("品牌色與發布條件會被嚴格驗證", () => {
  assert.equal(webinarLandingBrandSchema.safeParse({ primaryColor: "#123456", secondaryColor: "#abcdef", backgroundColor: "#ffffff" }).success, true);
  assert.equal(webinarLandingBrandSchema.safeParse({ primaryColor: "red", secondaryColor: "#abcdef", backgroundColor: "#ffffff" }).success, false);
  assert.equal(webinarLandingPageCanPublish({ publishStatus: "draft" }, defaultWebinarLandingTemplate({ title: "測試" })).ok, false);
  assert.equal(webinarLandingPageCanPublish({ publishStatus: "published" }, defaultWebinarLandingTemplate({ title: "測試" })).ok, true);
});

test("已發布頁面與後續草稿隔離，重新發布後才更新公開內容", async () => {
  const webinarId = crypto.randomUUID();
  const brand = { primaryColor: "#123456", secondaryColor: "#abcdef", backgroundColor: "#ffffff" };
  try {
    await db.insert(webinars).values({
      id: webinarId,
      title: "發布快照測試",
      vimeoUrl: "https://vimeo.com/1",
      startTime: new Date(Date.now() + 86_400_000),
      publishStatus: "published",
    });
    const original = defaultWebinarLandingTemplate({ title: "公開 A" });
    const originalSticky = original.find(block => block.type === "stickyCta")!;
    let page = await storage.createWebinarLandingPage({ webinarId, title: "公開 A", blocks: original, brandSettings: brand });
    page = (await storage.setWebinarLandingPageStatus(webinarId, page.version, "published"))!;
    const changed = defaultWebinarLandingTemplate({ title: "草稿 B" });
    const changedWithSticky = changed.map(block => block.type === "stickyCta"
      ? { ...block, headline: "草稿固定按鈕 B" }
      : block);
    page = (await storage.updateWebinarLandingPage(webinarId, page.version, { title: "草稿 B", blocks: changedWithSticky }))!;

    const stillPublicA = await storage.getPublicWebinarLandingPage(webinarId);
    assert.equal(stillPublicA?.title, "公開 A");
    assert.equal((stillPublicA?.blocks[0] as { headline: string }).headline, "公開 A");
    assert.equal(
      (stillPublicA?.blocks.find(block => block.type === "stickyCta") as { headline: string }).headline,
      originalSticky.headline,
    );

    await storage.setWebinarLandingPageStatus(webinarId, page.version, "published");
    const nowPublicB = await storage.getPublicWebinarLandingPage(webinarId);
    assert.equal(nowPublicB?.title, "草稿 B");
    assert.equal((nowPublicB?.blocks[0] as { headline: string }).headline, "草稿 B");
    assert.equal(
      (nowPublicB?.blocks.find(block => block.type === "stickyCta") as { headline: string }).headline,
      "草稿固定按鈕 B",
    );
  } finally {
    await db.delete(webinars).where(eq(webinars.id, webinarId));
  }
});