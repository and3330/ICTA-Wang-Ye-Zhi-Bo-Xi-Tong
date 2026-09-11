-- The no-card trial is intentionally independent from Stripe and from paid AI
-- credit lots. Retain the row after expiry so a trial can never be reset.
CREATE TABLE IF NOT EXISTS "no_card_trials" (
  "user_id" varchar PRIMARY KEY REFERENCES "users"("id") ON DELETE RESTRICT,
  "starts_at" timestamp NOT NULL,
  "expires_at" timestamp NOT NULL,
  "retention_until" timestamp NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "no_card_trials_duration_check"
    CHECK ("expires_at" = "starts_at" + interval '14 days'),
  CONSTRAINT "no_card_trials_retention_check"
    CHECK ("retention_until" >= "expires_at" + interval '30 days')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "no_card_trial_ai_calls" (
  "id" varchar PRIMARY KEY,
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "status" text NOT NULL DEFAULT 'reserved',
  "expires_at" timestamp NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "completed_at" timestamp,
  CONSTRAINT "no_card_trial_ai_calls_status_check"
    CHECK ("status" IN ('reserved', 'completed', 'refunded'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "no_card_trial_ai_calls_user_status_idx"
  ON "no_card_trial_ai_calls" ("user_id", "status");