ALTER TABLE "webinars" ADD COLUMN IF NOT EXISTS "meta_pixel_id" varchar(32);
ALTER TABLE "webinars" ADD COLUMN IF NOT EXISTS "gtm_container_id" varchar(24);

CREATE TABLE IF NOT EXISTS "webinar_funnel_events" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "webinar_id" varchar NOT NULL REFERENCES "webinars"("id") ON DELETE CASCADE,
  "event_type" text NOT NULL CHECK ("event_type" IN (
    'landing_view', 'registration', 'webinar_enter', 'video_progress',
    'dropoff', 'cta_view', 'cta_click', 'checkout_start', 'purchase'
  )),
  "registration_id" varchar REFERENCES "registrations"("id") ON DELETE SET NULL,
  "session_id" varchar(128),
  "cta_id" varchar REFERENCES "cta_buttons"("id") ON DELETE SET NULL,
  "visitor_token_hash" varchar(64),
  "position_seconds" integer CHECK ("position_seconds" IS NULL OR "position_seconds" >= 0),
  "value" numeric(14,2) CHECK ("value" IS NULL OR "value" >= 0),
  "currency" varchar(3),
  "dedupe_key" varchar(64) NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "occurred_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "webinar_funnel_events_value_currency_check"
    CHECK (("event_type" = 'purchase' AND "value" IS NOT NULL AND "currency" IS NOT NULL)
      OR ("event_type" <> 'purchase' AND "value" IS NULL AND "currency" IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS "webinar_funnel_events_webinar_dedupe_uniq"
  ON "webinar_funnel_events" ("webinar_id", "dedupe_key");
CREATE INDEX IF NOT EXISTS "webinar_funnel_events_webinar_occurred_idx"
  ON "webinar_funnel_events" ("webinar_id", "occurred_at");
CREATE INDEX IF NOT EXISTS "webinar_funnel_events_webinar_type_idx"
  ON "webinar_funnel_events" ("webinar_id", "event_type");