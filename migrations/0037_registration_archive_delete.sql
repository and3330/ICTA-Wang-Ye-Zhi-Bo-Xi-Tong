-- Hosts can archive (hide from the list) or delete (invalidate) registrations.
-- Rows are kept so orders, emails and analytics that point at them stay intact.
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS archived_at timestamp;
--> statement-breakpoint
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS deleted_at timestamp;
