CREATE INDEX IF NOT EXISTS email_reminders_due_idx
  ON email_reminders (status, scheduled_for);
CREATE INDEX IF NOT EXISTS email_reminders_lease_idx
  ON email_reminders (status, lease_expires_at);
CREATE INDEX IF NOT EXISTS email_sequences_enabled_webinar_idx
  ON email_sequences (enabled, webinar_id);
CREATE INDEX IF NOT EXISTS registrations_selected_session_idx
  ON registrations (selected_session, webinar_id)
  WHERE selected_session IS NOT NULL;