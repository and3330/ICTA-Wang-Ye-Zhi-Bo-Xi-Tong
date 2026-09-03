CREATE TABLE IF NOT EXISTS "ai_credit_lots" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "source" text NOT NULL CHECK ("source" IN ('legacy', 'monthly_gift', 'purchase', 'admin_grant')),
  "original_points" integer NOT NULL CHECK ("original_points" > 0),
  "remaining_points" integer NOT NULL CHECK ("remaining_points" >= 0 AND "remaining_points" <= "original_points"),
  "granted_at" timestamp NOT NULL DEFAULT now(),
  "expires_at" timestamp,
  "idempotency_key" text UNIQUE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_credit_lots_user_expiry_idx"
  ON "ai_credit_lots" ("user_id", "expires_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_credit_reservations" (
  "id" varchar PRIMARY KEY,
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "points" integer NOT NULL CHECK ("points" > 0),
  "allocations" jsonb NOT NULL,
  "status" text NOT NULL DEFAULT 'reserved' CHECK ("status" IN ('reserved', 'consumed', 'refunded')),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "completed_at" timestamp
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_credit_reservations_user_created_idx"
  ON "ai_credit_reservations" ("user_id", "created_at");
--> statement-breakpoint
INSERT INTO "ai_credit_lots" (
  "user_id", "source", "original_points", "remaining_points", "granted_at", "expires_at", "idempotency_key"
)
SELECT
  "id", 'legacy', "ai_points", "ai_points", COALESCE("created_at", now()), NULL, 'legacy:' || "id"
FROM "users"
WHERE "ai_points" > 0
ON CONFLICT ("idempotency_key") DO NOTHING;