-- Additive seller commerce order-management fields. Existing values are never
-- rewritten and buyer identity is intentionally never inferred/backfilled.
ALTER TABLE webinar_payments ADD COLUMN IF NOT EXISTS product_name_snapshot text;
ALTER TABLE webinar_payments ADD COLUMN IF NOT EXISTS buyer_name_snapshot text;
ALTER TABLE webinar_payments ADD COLUMN IF NOT EXISTS buyer_email_snapshot text;
ALTER TABLE webinar_payments ADD COLUMN IF NOT EXISTS provider_status text;
ALTER TABLE webinar_payments ADD COLUMN IF NOT EXISTS provider_status_message text;
ALTER TABLE webinar_payments ADD COLUMN IF NOT EXISTS internal_note text;
ALTER TABLE webinar_payments ADD COLUMN IF NOT EXISTS fulfillment_status text NOT NULL DEFAULT 'pending';
ALTER TABLE webinar_payments ADD COLUMN IF NOT EXISTS operation_version integer NOT NULL DEFAULT 1;
ALTER TABLE webinar_payments ADD COLUMN IF NOT EXISTS operation_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE webinar_payments DROP CONSTRAINT IF EXISTS webinar_payments_fulfillment_status_check;
ALTER TABLE webinar_payments ADD CONSTRAINT webinar_payments_fulfillment_status_check
  CHECK (fulfillment_status IN ('pending', 'in_progress', 'completed', 'cancelled'));
ALTER TABLE webinar_payments DROP CONSTRAINT IF EXISTS webinar_payments_operation_version_check;
ALTER TABLE webinar_payments ADD CONSTRAINT webinar_payments_operation_version_check
  CHECK (operation_version >= 1);

CREATE TABLE IF NOT EXISTS member_order_events (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id varchar NOT NULL REFERENCES webinar_payments(id) ON DELETE RESTRICT,
  actor_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  reason text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS webinar_payments_owner_created_idx ON webinar_payments(user_id, created_at);
CREATE INDEX IF NOT EXISTS webinar_payments_owner_status_idx ON webinar_payments(user_id, status);
CREATE INDEX IF NOT EXISTS webinar_payments_offer_created_idx ON webinar_payments(offer_id, created_at);
CREATE INDEX IF NOT EXISTS member_order_events_payment_occurred_idx ON member_order_events(payment_id, occurred_at);