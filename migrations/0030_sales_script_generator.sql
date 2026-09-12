CREATE TABLE IF NOT EXISTS sales_script_drafts (
  webinar_id varchar PRIMARY KEY REFERENCES webinars(id) ON DELETE CASCADE,
  owner_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS sales_script_jobs (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  webinar_id varchar NOT NULL REFERENCES webinars(id) ON DELETE CASCADE,
  owner_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reservation_id varchar NOT NULL UNIQUE REFERENCES ai_credit_reservations(id) ON DELETE RESTRICT,
  idempotency_key varchar(160) NOT NULL,
  answers jsonb NOT NULL,
  cost_points integer NOT NULL DEFAULT 3600 CHECK (cost_points = 3600),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  completed_stages integer NOT NULL DEFAULT 0 CHECK (completed_stages BETWEEN 0 AND 6),
  attempt_count integer NOT NULL DEFAULT 0,
  lease_token varchar(64),
  lease_expires_at timestamp,
  result jsonb,
  error_message text,
  completed_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  UNIQUE (owner_id, idempotency_key)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sales_script_jobs_owner_webinar_created_idx ON sales_script_jobs(owner_id, webinar_id, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sales_script_jobs_claim_idx ON sales_script_jobs(status, lease_expires_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS sales_script_job_checkpoints (
  job_id varchar NOT NULL REFERENCES sales_script_jobs(id) ON DELETE CASCADE,
  stage integer NOT NULL CHECK (stage BETWEEN 1 AND 6),
  section jsonb NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, stage)
);