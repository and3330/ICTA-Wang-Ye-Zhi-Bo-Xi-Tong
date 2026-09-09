import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { webinars } from "@shared/schema";
import {
  webinarLandingBlocksSchema, webinarLandingBrandSchema, defaultWebinarLandingTemplate,
  landingImageUrlSchema, webinarLandingPageCanPublish,
} from "./webinarLandingPages";

test("預設模板包含完整落地頁區塊", () => {
  const blocks = defaultWebinarLandingTemplate({ title: "測試說明會", description: "介紹" });
  assert.deepEqual(blocks.map(block => block.type), ["hero", "intro", "audience", "agenda", "instructor", "faq", "countdown", "cta"]);
  assert.equal(webinarLandingBlocksSchema.safeParse(blocks).success, true);
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
    let page = await storage.createWebinarLandingPage({ webinarId, title: "公開 A", blocks: original, brandSettings: brand });
    page = (await storage.setWebinarLandingPageStatus(webinarId, page.version, "published"))!;
    const changed = defaultWebinarLandingTemplate({ title: "草稿 B" });
    page = (await storage.updateWebinarLandingPage(webinarId, page.version, { title: "草稿 B", blocks: changed }))!;

    const stillPublicA = await storage.getPublicWebinarLandingPage(webinarId);
    assert.equal(stillPublicA?.title, "公開 A");
    assert.equal((stillPublicA?.blocks[0] as { headline: string }).headline, "公開 A");

    await storage.setWebinarLandingPageStatus(webinarId, page.version, "published");
    const nowPublicB = await storage.getPublicWebinarLandingPage(webinarId);
    assert.equal(nowPublicB?.title, "草稿 B");
    assert.equal((nowPublicB?.blocks[0] as { headline: string }).headline, "草稿 B");
  } finally {
    await db.delete(webinars).where(eq(webinars.id, webinarId));
  }
});