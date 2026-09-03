ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "stripe_subscription_checkout_session_id" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "stripe_trial_claimed_at" timestamp;