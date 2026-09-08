CREATE TABLE IF NOT EXISTS "offer_sales_pages" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "webinar_id" varchar NOT NULL REFERENCES "webinars"("id") ON DELETE CASCADE,
  "offer_id" varchar NOT NULL REFERENCES "webinar_offers"("id") ON DELETE RESTRICT,
  "slug" varchar(80) NOT NULL UNIQUE,
  "title" varchar(200) NOT NULL,
  "status" text NOT NULL DEFAULT 'draft' CHECK ("status" IN ('draft', 'published')),
  "ordered_blocks" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "version" integer NOT NULL DEFAULT 1 CHECK ("version" > 0),
  "published_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "offer_sales_pages_offer_uniq" UNIQUE ("offer_id"),
  CONSTRAINT "offer_sales_pages_slug_normalized_check"
    CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

CREATE INDEX IF NOT EXISTS "offer_sales_pages_webinar_idx"
  ON "offer_sales_pages" ("webinar_id");

-- Sales pages identify the immutable server-side offer directly and reuse the
-- existing checkout/payment pipeline without requiring an unrelated CTA row.
ALTER TABLE "webinar_payments" ALTER COLUMN "cta_id" DROP NOT NULL;