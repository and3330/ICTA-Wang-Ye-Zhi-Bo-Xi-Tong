ALTER TABLE "offer_sales_pages"
  ADD COLUMN IF NOT EXISTS "checkout_settings" jsonb NOT NULL DEFAULT '{
    "transitionTitle":"正在前往安全付款頁面",
    "transitionMessage":"請稍候，我們正在準備您的付款。",
    "successTitle":"付款成功，謝謝您的支持！",
    "successMessage":"您的購買已確認。",
    "successButtonLabel":"前往內容",
    "cancelTitle":"付款尚未完成",
    "cancelMessage":"您可以返回優惠頁，再試一次。"
  }'::jsonb;
ALTER TABLE "offer_sales_pages" ADD COLUMN IF NOT EXISTS "published_checkout_settings" jsonb;
ALTER TABLE "offer_sales_pages" ADD COLUMN IF NOT EXISTS "published_ordered_blocks" jsonb;
UPDATE "offer_sales_pages"
SET "published_checkout_settings" = "checkout_settings",
    "published_ordered_blocks" = "ordered_blocks"
WHERE "status" = 'published'
  AND ("published_checkout_settings" IS NULL OR "published_ordered_blocks" IS NULL);
ALTER TABLE "webinar_payments" ADD COLUMN IF NOT EXISTS "checkout_status_token_hash" varchar(64);
CREATE UNIQUE INDEX IF NOT EXISTS "webinar_payments_checkout_status_token_hash_uniq"
  ON "webinar_payments" ("checkout_status_token_hash") WHERE "checkout_status_token_hash" IS NOT NULL;
ALTER TABLE "webinar_payments" ADD COLUMN IF NOT EXISTS "sales_page_id" varchar REFERENCES "offer_sales_pages"("id") ON DELETE SET NULL;
ALTER TABLE "webinar_payments" ADD COLUMN IF NOT EXISTS "sales_page_version" integer;
ALTER TABLE "webinar_payments" ADD COLUMN IF NOT EXISTS "checkout_settings_snapshot" jsonb;
ALTER TABLE "webinar_payments" ADD COLUMN IF NOT EXISTS "offer_slug_snapshot" varchar(80);
ALTER TABLE "webinar_payments" ADD COLUMN IF NOT EXISTS "origin_sales_page_id_snapshot" varchar;

-- Stripe orders are created locally before the provider session exists. Permit
-- only that narrow pending/capability-bound state; every completed Stripe row
-- still requires a provider session, and ECPay invariants remain unchanged.
ALTER TABLE "webinar_payments" DROP CONSTRAINT IF EXISTS "webinar_payments_provider_check";
ALTER TABLE "webinar_payments" ADD CONSTRAINT "webinar_payments_provider_check" CHECK (
  (
    "payment_provider" = 'stripe'
    AND (
      "stripe_checkout_session_id" IS NOT NULL
      OR (
        "status" = 'pending'
        AND "checkout_status_token_hash" IS NOT NULL
        AND "stripe_payment_intent_id" IS NULL
      )
    )
  )
  OR (
    "payment_provider" = 'ecpay'
    AND "provider_order_id" IS NOT NULL
    AND "ecpay_connection_id" IS NOT NULL
    AND "merchant_id_snapshot" IS NOT NULL
  )
);