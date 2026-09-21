CREATE TABLE IF NOT EXISTS "course_marketplace_listings" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "webinar_id" varchar NOT NULL UNIQUE REFERENCES "webinars"("id") ON DELETE CASCADE,
  "owner_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "opted_in" boolean NOT NULL DEFAULT false,
  "status" text NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending','approved','rejected','withdrawn')),
  "rejection_reason" text,
  "approved_title" text,
  "approved_summary" text,
  "approved_cover" text,
  "requested_at" timestamp,
  "approved_at" timestamp,
  "reviewed_at" timestamp,
  "reviewed_by" varchar REFERENCES "users"("id") ON DELETE SET NULL,
  "version" integer NOT NULL DEFAULT 1 CHECK ("version" > 0),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "course_marketplace_listings_queue_idx" ON "course_marketplace_listings" ("status","opted_in");
CREATE INDEX IF NOT EXISTS "course_marketplace_listings_owner_idx" ON "course_marketplace_listings" ("owner_id");