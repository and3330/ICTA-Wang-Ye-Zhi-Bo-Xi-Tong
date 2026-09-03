CREATE TABLE IF NOT EXISTS "webinar_pending_refunds" (
  "stripe_event_id" text PRIMARY KEY,
  "stripe_payment_intent_id" text NOT NULL,
  "cumulative_refund_minor" integer NOT NULL CHECK ("cumulative_refund_minor" >= 0),
  "currency" varchar(3),
  "reconciled_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "webinar_pending_refunds_payment_idx"
  ON "webinar_pending_refunds" ("stripe_payment_intent_id");