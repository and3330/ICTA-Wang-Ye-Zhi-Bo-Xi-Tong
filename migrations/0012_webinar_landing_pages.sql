CREATE TABLE IF NOT EXISTS "webinar_landing_pages" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "webinar_id" varchar NOT NULL UNIQUE REFERENCES "webinars"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "blocks" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "brand_settings" jsonb NOT NULL DEFAULT '{"primaryColor":"#0f766e","secondaryColor":"#f59e0b","backgroundColor":"#ffffff"}'::jsonb,
  "published_title" text,
  "published_blocks" jsonb,
  "published_brand_settings" jsonb,
  "status" text NOT NULL DEFAULT 'draft' CHECK ("status" IN ('draft', 'published')),
  "version" integer NOT NULL DEFAULT 1 CHECK ("version" > 0),
  "published_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "webinar_landing_pages_webinar_idx" ON "webinar_landing_pages" ("webinar_id");

-- Preserve existing public registration links by giving every legacy published
-- webinar the same safe, data-only full template that new pages start from.
INSERT INTO "webinar_landing_pages" (
  "webinar_id", "title", "blocks", "brand_settings",
  "published_title", "published_blocks", "published_brand_settings",
  "status", "published_at"
)
SELECT
  w."id",
  w."title",
  jsonb_build_array(
    jsonb_build_object('id','hero','type','hero','enabled',true,'headline',w."title",'subheadline','一場為你準備的線上分享，立即加入並掌握重點。','ctaLabel','立即免費報名'),
    jsonb_build_object('id','intro','type','intro','enabled',true,'headline','你將在這場分享中獲得什麼？','content',coalesce(nullif(trim(w."description"),''),'透過清楚的步驟與實用內容，帶你建立可立即應用的行動方案。')),
    jsonb_build_object('id','audience','type','audience','enabled',true,'headline','適合這些參與者','items',jsonb_build_array('想快速掌握核心觀念的你','正在尋找可執行方法的你','希望與同樣關心主題的人交流的你')),
    jsonb_build_object('id','agenda','type','agenda','enabled',true,'headline','活動內容大綱','items',jsonb_build_array('核心觀念與關鍵策略','實例拆解與應用','問答與下一步')),
    jsonb_build_object('id','instructor','type','instructor','enabled',true,'headline','講師介紹','name','主講人','bio','專注於分享實用經驗，陪你把想法轉化為成果。'),
    jsonb_build_object('id','faq','type','faq','enabled',true,'items',jsonb_build_array(jsonb_build_object('question','需要付費嗎？','answer','本活動報名方式與費用以報名表單顯示為準。'),jsonb_build_object('question','報名後如何參加？','answer','完成報名後，你會收到活動資訊與參加方式。'))),
    jsonb_build_object('id','countdown','type','countdown','enabled',true,'headline','活動即將開始'),
    jsonb_build_object('id','cta','type','cta','enabled',true,'headline','現在就保留你的席次','ctaLabel','前往報名')
  ),
  '{"primaryColor":"#0f766e","secondaryColor":"#f59e0b","backgroundColor":"#ffffff"}'::jsonb,
  w."title",
  jsonb_build_array(
    jsonb_build_object('id','hero','type','hero','enabled',true,'headline',w."title",'subheadline','一場為你準備的線上分享，立即加入並掌握重點。','ctaLabel','立即免費報名'),
    jsonb_build_object('id','intro','type','intro','enabled',true,'headline','你將在這場分享中獲得什麼？','content',coalesce(nullif(trim(w."description"),''),'透過清楚的步驟與實用內容，帶你建立可立即應用的行動方案。')),
    jsonb_build_object('id','audience','type','audience','enabled',true,'headline','適合這些參與者','items',jsonb_build_array('想快速掌握核心觀念的你','正在尋找可執行方法的你','希望與同樣關心主題的人交流的你')),
    jsonb_build_object('id','agenda','type','agenda','enabled',true,'headline','活動內容大綱','items',jsonb_build_array('核心觀念與關鍵策略','實例拆解與應用','問答與下一步')),
    jsonb_build_object('id','instructor','type','instructor','enabled',true,'headline','講師介紹','name','主講人','bio','專注於分享實用經驗，陪你把想法轉化為成果。'),
    jsonb_build_object('id','faq','type','faq','enabled',true,'items',jsonb_build_array(jsonb_build_object('question','需要付費嗎？','answer','本活動報名方式與費用以報名表單顯示為準。'),jsonb_build_object('question','報名後如何參加？','answer','完成報名後，你會收到活動資訊與參加方式。'))),
    jsonb_build_object('id','countdown','type','countdown','enabled',true,'headline','活動即將開始'),
    jsonb_build_object('id','cta','type','cta','enabled',true,'headline','現在就保留你的席次','ctaLabel','前往報名')
  ),
  '{"primaryColor":"#0f766e","secondaryColor":"#f59e0b","backgroundColor":"#ffffff"}'::jsonb,
  'published',
  now()
FROM "webinars" w
WHERE w."publish_status" = 'published'
ON CONFLICT ("webinar_id") DO NOTHING;