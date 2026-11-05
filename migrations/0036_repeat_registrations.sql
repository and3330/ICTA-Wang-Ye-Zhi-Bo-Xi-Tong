-- Email is contact information, not a unique attendee/signup identifier.
-- Preserve all registrations and legacy identity rows for compatibility.
-- Apply before deploying the application change that admits repeat signups.
DROP TRIGGER IF EXISTS registrations_email_identity_trigger ON registrations;
DROP FUNCTION IF EXISTS enforce_registration_email_identity();
DROP INDEX IF EXISTS registrations_webinar_email_uniq;
