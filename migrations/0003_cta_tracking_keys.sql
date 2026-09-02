ALTER TABLE "cta_buttons" ADD COLUMN IF NOT EXISTS "cta_key" varchar(64);
UPDATE "cta_buttons"
SET "cta_key" = replace(gen_random_uuid()::text, '-', '')
WHERE "cta_key" IS NULL;
ALTER TABLE "cta_buttons" ALTER COLUMN "cta_key" SET NOT NULL;
DROP INDEX IF EXISTS "cta_buttons_cta_key_uniq";
CREATE UNIQUE INDEX "cta_buttons_cta_key_uniq" ON "cta_buttons" ("cta_key");

ALTER TABLE "webinar_funnel_events" ADD COLUMN IF NOT EXISTS "cta_key" varchar(64);
CREATE INDEX IF NOT EXISTS "webinar_funnel_events_webinar_cta_key_idx"
  ON "webinar_funnel_events" ("webinar_id", "cta_key") WHERE "cta_key" IS NOT NULL;