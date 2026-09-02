ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_verification_required" boolean NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_verified_at" timestamp;

CREATE TABLE IF NOT EXISTS "auth_tokens" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "purpose" text NOT NULL,
  "token_hash" text NOT NULL UNIQUE,
  "expires_at" timestamp NOT NULL,
  "consumed_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "auth_tokens_user_purpose_idx" ON "auth_tokens" ("user_id", "purpose");

CREATE TABLE IF NOT EXISTS "rate_limit_buckets" (
  "key" text PRIMARY KEY,
  "window_started_at" timestamp NOT NULL,
  "request_count" integer NOT NULL DEFAULT 1,
  "expires_at" timestamp NOT NULL
);
CREATE INDEX IF NOT EXISTS "rate_limit_buckets_expires_idx" ON "rate_limit_buckets" ("expires_at");

CREATE TABLE IF NOT EXISTS "error_events" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "fingerprint" text NOT NULL,
  "method" text,
  "path" text,
  "status_code" integer NOT NULL DEFAULT 500,
  "message" text NOT NULL,
  "stack" text,
  "user_id" varchar,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "error_events_created_idx" ON "error_events" ("created_at");

CREATE TABLE IF NOT EXISTS "support_feedback" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "category" text NOT NULL DEFAULT 'feedback',
  "subject" text NOT NULL,
  "message" text NOT NULL,
  "status" text NOT NULL DEFAULT 'open',
  "admin_note" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "support_feedback_created_idx" ON "support_feedback" ("created_at");