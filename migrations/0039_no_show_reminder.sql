CREATE UNIQUE INDEX IF NOT EXISTS email_reminders_no_show_uniq
ON email_reminders (registration_id)
WHERE reminder_type = 'reminder_no_show_10m';
