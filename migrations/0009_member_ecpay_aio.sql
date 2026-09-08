CREATE TABLE IF NOT EXISTS "ecpay_connections" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" varchar NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE CASCADE,
  "merchant_id" varchar(10) NOT NULL,
  "environment" text NOT NULL DEFAULT 'stage' CHECK ("environment" IN ('stage','production')),
  "hash_key_encrypted" text NOT NULL,
  "hash_iv_encrypted" text NOT NULL,
  "enabled" boolean NOT NULL DEFAULT false,
  "verified_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

ALTER TABLE "webinar_offers" ADD COLUMN IF NOT EXISTS "payment_provider" text NOT NULL DEFAULT 'stripe';
ALTER TABLE "webinar_offers" ADD COLUMN IF NOT EXISTS "ecpay_item_name" text;
ALTER TABLE "webinar_offers" ADD COLUMN IF NOT EXISTS "ecpay_amount_twd" integer;
ALTER TABLE "webinar_offers" ALTER COLUMN "stripe_product_id" DROP NOT NULL;
ALTER TABLE "webinar_offers" ALTER COLUMN "stripe_price_id" DROP NOT NULL;
ALTER TABLE "webinar_offers" DROP CONSTRAINT IF EXISTS "webinar_offers_provider_check";
ALTER TABLE "webinar_offers" ADD CONSTRAINT "webinar_offers_provider_check" CHECK (
  ("payment_provider" = 'stripe' AND "stripe_product_id" IS NOT NULL AND "stripe_price_id" IS NOT NULL)
  OR ("payment_provider" = 'ecpay' AND "ecpay_item_name" IS NOT NULL AND "ecpay_amount_twd" > 0)
);

ALTER TABLE "webinar_payments" ADD COLUMN IF NOT EXISTS "payment_provider" text NOT NULL DEFAULT 'stripe';
ALTER TABLE "webinar_payments" ALTER COLUMN "stripe_checkout_session_id" DROP NOT NULL;
ALTER TABLE "webinar_payments" ADD COLUMN IF NOT EXISTS "provider_order_id" varchar(64) UNIQUE;
ALTER TABLE "webinar_payments" ADD COLUMN IF NOT EXISTS "ecpay_connection_id" varchar REFERENCES "ecpay_connections"("id") ON DELETE RESTRICT;
ALTER TABLE "webinar_payments" ADD COLUMN IF NOT EXISTS "merchant_id_snapshot" varchar(10);
ALTER TABLE "webinar_payments" ADD COLUMN IF NOT EXISTS "provider_environment" text;
ALTER TABLE "webinar_payments" ADD COLUMN IF NOT EXISTS "provider_hash_key_snapshot" text;
ALTER TABLE "webinar_payments" ADD COLUMN IF NOT EXISTS "provider_hash_iv_snapshot" text;
ALTER TABLE "webinar_payments" ALTER COLUMN "purchased_at" DROP NOT NULL;
ALTER TABLE "webinar_payments" ALTER COLUMN "purchased_at" DROP DEFAULT;
ALTER TABLE "webinar_payments" DROP CONSTRAINT IF EXISTS "webinar_payments_provider_check";
ALTER TABLE "webinar_payments" ADD CONSTRAINT "webinar_payments_provider_check" CHECK (
  ("payment_provider" = 'stripe' AND "stripe_checkout_session_id" IS NOT NULL)
  OR ("payment_provider" = 'ecpay' AND "provider_order_id" IS NOT NULL AND "ecpay_connection_id" IS NOT NULL AND "merchant_id_snapshot" IS NOT NULL)
);