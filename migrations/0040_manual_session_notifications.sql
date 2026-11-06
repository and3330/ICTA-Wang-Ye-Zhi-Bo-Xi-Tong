CREATE TABLE IF NOT EXISTS session_notification_batches (
  id varchar PRIMARY KEY,
  webinar_id varchar NOT NULL REFERENCES webinars(id) ON DELETE CASCADE,
  session_id varchar NOT NULL REFERENCES webinar_sessions(id) ON DELETE CASCADE,
  scheduled_start timestamp NOT NULL,
  audience text NOT NULL,
  recipient_count integer NOT NULL,
  created_by varchar NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE email_reminders ADD COLUMN IF NOT EXISTS notification_batch_id varchar REFERENCES session_notification_batches(id) ON DELETE CASCADE;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS email_reminders_manual_notice_uniq
ON email_reminders (registration_id, notification_batch_id)
WHERE notification_batch_id IS NOT NULL;
