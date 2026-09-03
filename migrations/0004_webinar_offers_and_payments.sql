CREATE TABLE IF NOT EXISTS "webinar_offers" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "webinar_id" varchar NOT NULL REFERENCES "webinars"("id") ON DELETE CASCADE,
  "stripe_product_id" text NOT NULL,
  "stripe_price_id" text NOT NULL,
  "checkout_mode" text NOT NULL DEFAULT 'payment' CHECK ("checkout_mode" = 'payment'),
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "webinar_offers_webinar_idx" ON "webinar_offers" ("webinar_id");

ALTER TABLE "cta_buttons" ALTER COLUMN "url" DROP NOT NULL;
ALTER TABLE "cta_buttons" ADD COLUMN IF NOT EXISTS "offer_id" varchar REFERENCES "webinar_offers"("id") ON DELETE RESTRICT;
ALTER TABLE "cta_buttons" DROP CONSTRAINT IF EXISTS "cta_buttons_destination_check";
ALTER TABLE "cta_buttons" ADD CONSTRAINT "cta_buttons_destination_check"
  CHECK ("url" IS NOT NULL OR "offer_id" IS NOT NULL);

ALTER TABLE "webinar_funnel_events" DROP CONSTRAINT IF EXISTS "webinar_funnel_events_event_type_check";
ALTER TABLE "webinar_funnel_events" DROP CONSTRAINT IF EXISTS "webinar_funnel_events_value_currency_check";
ALTER TABLE "webinar_funnel_events" ADD COLUMN IF NOT EXISTS "offer_id" varchar REFERENCES "webinar_offers"("id") ON DELETE SET NULL;
ALTER TABLE "webinar_funnel_events" ADD COLUMN IF NOT EXISTS "amount_minor" integer;
-- Normalize any legacy major-unit purchase values before enforcing the new
-- minor-unit invariant. Stripe's zero-decimal currencies are not multiplied.
UPDATE "webinar_funnel_events"
SET "amount_minor" = CASE
  WHEN upper("currency") IN ('BIF','CLP','DJF','GNF','JPY','KMF','KRW','MGA','PYG','RWF','UGX','VND','VUV','XAF','XOF','XPF')
    THEN round("value")::integer
  ELSE round("value" * 100)::integer
END
WHERE "event_type" = 'purchase' AND "amount_minor" IS NULL AND "value" IS NOT NULL;
ALTER TABLE "webinar_funnel_events" ADD CONSTRAINT "webinar_funnel_events_event_type_check"
  CHECK ("event_type" IN ('landing_view','registration','webinar_enter','video_progress','dropoff','cta_view','cta_click','checkout_start','purchase','refund'));
ALTER TABLE "webinar_funnel_events" DROP CONSTRAINT IF EXISTS "webinar_funnel_events_payment_value_check";
ALTER TABLE "webinar_funnel_events" ADD CONSTRAINT "webinar_funnel_events_payment_value_check"
  CHECK (
    ("event_type" IN ('purchase','refund') AND "amount_minor" IS NOT NULL AND "amount_minor" >= 0 AND "currency" IS NOT NULL)
    OR ("event_type" NOT IN ('purchase','refund') AND "amount_minor" IS NULL AND "value" IS NULL AND "currency" IS NULL)
  );

CREATE TABLE IF NOT EXISTS "stripe_webhook_events" (
  "id" text PRIMARY KEY,
  "event_type" text NOT NULL,
  "processed_at" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "webinar_payments" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "webinar_id" varchar NOT NULL REFERENCES "webinars"("id") ON DELETE RESTRICT,
  "offer_id" varchar NOT NULL REFERENCES "webinar_offers"("id") ON DELETE RESTRICT,
  "cta_id" varchar NOT NULL REFERENCES "cta_buttons"("id") ON DELETE RESTRICT,
  "registration_id" varchar REFERENCES "registrations"("id") ON DELETE SET NULL,
  "visitor_token_hash" varchar(64),
  "stripe_checkout_session_id" text NOT NULL UNIQUE,
  "stripe_payment_intent_id" text UNIQUE,
  "amount_minor" integer NOT NULL CHECK ("amount_minor" >= 0),
  "refunded_minor" integer NOT NULL DEFAULT 0 CHECK ("refunded_minor" >= 0),
  "currency" varchar(3) NOT NULL,
  "status" text NOT NULL DEFAULT 'paid',
  "purchased_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CHECK ("refunded_minor" <= "amount_minor")
);