CREATE TABLE IF NOT EXISTS "media_assets" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "provider" text NOT NULL,
  "provider_id" text,
  "storage_key" text,
  "name" text NOT NULL,
  "status" text NOT NULL DEFAULT 'uploading',
  "size_bytes" bigint NOT NULL,
  "content_type" text,
  "duration_seconds" integer,
  "url" text,
  "thumbnail_url" text,
  "error_code" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "media_assets_kind_check" CHECK ("kind" IN ('video', 'image')),
  CONSTRAINT "media_assets_provider_check" CHECK ("provider" IN ('bunny_stream', 'bunny_storage', 'legacy')),
  CONSTRAINT "media_assets_status_check" CHECK ("status" IN ('uploading', 'processing', 'ready', 'failed')),
  CONSTRAINT "media_assets_size_check" CHECK ("size_bytes" >= 0)
);
CREATE INDEX IF NOT EXISTS "media_assets_user_created_idx" ON "media_assets" ("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "media_assets_user_video_quota_idx" ON "media_assets" ("user_id", "kind", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "media_assets_provider_id_uniq" ON "media_assets" ("provider", "provider_id") WHERE "provider_id" IS NOT NULL;

ALTER TABLE "webinars" ADD COLUMN IF NOT EXISTS "video_provider" text NOT NULL DEFAULT 'vimeo';
ALTER TABLE "webinars" ADD COLUMN IF NOT EXISTS "video_asset_id" varchar;
ALTER TABLE "webinars" ADD CONSTRAINT "webinars_video_provider_check" CHECK ("video_provider" IN ('vimeo', 'bunny'));
ALTER TABLE "webinars" ADD CONSTRAINT "webinars_video_asset_id_fk"
  FOREIGN KEY ("video_asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS "webinars_video_asset_idx" ON "webinars" ("video_asset_id") WHERE "video_asset_id" IS NOT NULL;

ALTER TABLE "uploaded_assets" ADD COLUMN IF NOT EXISTS "storage_backend" text NOT NULL DEFAULT 'legacy';
ALTER TABLE "uploaded_assets" ADD COLUMN IF NOT EXISTS "storage_key" text;
ALTER TABLE "uploaded_assets" ADD COLUMN IF NOT EXISTS "content_type" text;
ALTER TABLE "uploaded_assets" ADD COLUMN IF NOT EXISTS "size_bytes" integer;
ALTER TABLE "uploaded_assets" ADD CONSTRAINT "uploaded_assets_storage_backend_check"
  CHECK ("storage_backend" IN ('legacy', 'app_storage', 'bunny_storage'));