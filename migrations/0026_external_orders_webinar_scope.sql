-- 0025 has already been applied. Preserve its rows while moving aggregates and
-- idempotency keys from member-wide to member+webinar scope.
ALTER TABLE external_orders ADD COLUMN IF NOT EXISTS purchase_observed boolean NOT NULL DEFAULT false;
UPDATE external_orders SET purchase_observed = true WHERE gross_paid_minor > 0;
ALTER TABLE external_handoffs ADD COLUMN IF NOT EXISTS include_contact boolean NOT NULL DEFAULT false;
ALTER TABLE external_referrals DROP CONSTRAINT IF EXISTS external_referrals_session_provenance_check;
ALTER TABLE external_referrals ADD CONSTRAINT external_referrals_session_provenance_check
  CHECK (session_provenance IN ('registration_success', 'registered_watch_token', 'declared_session', 'anonymous'));

ALTER TABLE external_orders DROP CONSTRAINT IF EXISTS external_orders_owner_order_uniq;
DROP INDEX IF EXISTS external_orders_owner_order_uniq;
CREATE UNIQUE INDEX IF NOT EXISTS external_orders_owner_webinar_order_uniq
  ON external_orders(owner_id, webinar_id, order_id);

ALTER TABLE external_order_events DROP CONSTRAINT IF EXISTS external_order_events_owner_event_uniq;
DROP INDEX IF EXISTS external_order_events_owner_event_uniq;
CREATE UNIQUE INDEX IF NOT EXISTS external_order_events_owner_webinar_event_uniq
  ON external_order_events(owner_id, webinar_id, event_id);
CREATE INDEX IF NOT EXISTS external_order_events_owner_webinar_order_idx
  ON external_order_events(owner_id, webinar_id, order_id);