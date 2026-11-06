CREATE UNIQUE INDEX IF NOT EXISTS email_reminders_start_uniq
ON email_reminders (registration_id, reminder_type)
WHERE reminder_type IN ('reminder_5m', 'reminder_start');
