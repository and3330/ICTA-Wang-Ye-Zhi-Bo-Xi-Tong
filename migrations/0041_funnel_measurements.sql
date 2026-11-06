ALTER TABLE webinars ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS watch_measurement_version integer NOT NULL DEFAULT 1;
ALTER TABLE viewer_progress ADD COLUMN IF NOT EXISTS measurement_version integer NOT NULL DEFAULT 1;
ALTER TABLE viewer_progress ADD COLUMN IF NOT EXISTS started_at timestamp NOT NULL DEFAULT now();
ALTER TABLE webinar_funnel_events ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
ALTER TABLE external_referrals ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
ALTER TABLE external_order_events ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
ALTER TABLE external_orders ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
ALTER TABLE external_orders ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'pending';
UPDATE external_orders SET payment_status =
  CASE WHEN purchase_observed AND refunded_minor > 0 AND refunded_minor >= gross_paid_minor THEN 'refunded'
       WHEN purchase_observed AND refunded_minor > 0 THEN 'partially_refunded'
       WHEN purchase_observed THEN 'paid'
       WHEN refunded_minor > 0 THEN 'refund_pending'
       ELSE 'pending' END;
