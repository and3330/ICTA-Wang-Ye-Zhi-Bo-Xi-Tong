-- A durable paid entitlement precedes the confidential questionnaire.  Old
-- jobs remain valid historical records and therefore have a null purchase_id.
CREATE TABLE IF NOT EXISTS sales_script_purchases (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  webinar_id varchar NOT NULL REFERENCES webinars(id) ON DELETE CASCADE,
  owner_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reservation_id varchar NOT NULL UNIQUE REFERENCES ai_credit_reservations(id) ON DELETE RESTRICT,
  idempotency_key varchar(160) NOT NULL,
  basic_answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  cost_points integer NOT NULL DEFAULT 3600,
  status text NOT NULL DEFAULT 'ready',
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  completed_at timestamp
);
--> statement-breakpoint
ALTER TABLE sales_script_jobs ADD COLUMN IF NOT EXISTS purchase_id varchar;
--> statement-breakpoint
ALTER TABLE sales_script_jobs
  ADD CONSTRAINT sales_script_jobs_purchase_id_fkey
  FOREIGN KEY (purchase_id) REFERENCES sales_script_purchases(id) ON DELETE RESTRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS sales_script_purchases_owner_idempotency_uniq
  ON sales_script_purchases(owner_id, idempotency_key);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS sales_script_purchases_one_active_uniq
  ON sales_script_purchases(owner_id, webinar_id)
  WHERE status IN ('ready', 'generating');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sales_script_purchases_owner_webinar_created_idx
  ON sales_script_purchases(owner_id, webinar_id, created_at);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS sales_script_jobs_purchase_id_uniq
  ON sales_script_jobs(purchase_id) WHERE purchase_id IS NOT NULL;