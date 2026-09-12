-- Keep NODE_ENV=test workers from ever claiming development jobs in a shared
-- database. This is server-owned routing metadata, not request input.
ALTER TABLE sales_script_jobs
  ADD COLUMN IF NOT EXISTS queue_scope varchar(120) NOT NULL DEFAULT 'app';
--> statement-breakpoint
DROP INDEX IF EXISTS sales_script_jobs_claim_idx;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sales_script_jobs_claim_idx
  ON sales_script_jobs(queue_scope, status, lease_expires_at);