-- Finalize reliability/security schema for databases that already ran the
-- initial 0014 migration. Every statement is safe on fresh databases too.
CREATE TABLE IF NOT EXISTS sellcase_data_migrations (
  key text PRIMARY KEY,
  applied_at timestamp NOT NULL DEFAULT now()
);
INSERT INTO sellcase_data_migrations (key)
VALUES ('ecpay_minor_units_v1')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE webinars ADD COLUMN IF NOT EXISTS deleted_at timestamp;

DROP INDEX IF EXISTS registrations_webinar_email_uniq;
CREATE TABLE IF NOT EXISTS registration_identity_keys (
  webinar_id varchar NOT NULL REFERENCES webinars(id),
  normalized_email text NOT NULL,
  registration_id varchar REFERENCES registrations(id),
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS registration_identity_keys_uniq
  ON registration_identity_keys (webinar_id, normalized_email);
INSERT INTO registration_identity_keys (webinar_id, normalized_email, registration_id, created_at)
SELECT DISTINCT ON (webinar_id, lower(btrim(email)))
  webinar_id, lower(btrim(email)), id, COALESCE(registered_at, now())
FROM registrations
ORDER BY webinar_id, lower(btrim(email)), registered_at NULLS LAST, id
ON CONFLICT (webinar_id, normalized_email) DO NOTHING;

CREATE OR REPLACE FUNCTION enforce_registration_email_identity()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE existing_registration_id varchar;
BEGIN
  IF TG_OP = 'UPDATE' AND
     (OLD.webinar_id, lower(btrim(OLD.email))) IS DISTINCT FROM
     (NEW.webinar_id, lower(btrim(NEW.email))) THEN
    DELETE FROM registration_identity_keys
    WHERE webinar_id = OLD.webinar_id
      AND normalized_email = lower(btrim(OLD.email))
      AND registration_id = OLD.id;
  END IF;

  INSERT INTO registration_identity_keys (webinar_id, normalized_email, registration_id)
  VALUES (NEW.webinar_id, lower(btrim(NEW.email)), NEW.id)
  ON CONFLICT (webinar_id, normalized_email) DO NOTHING
  RETURNING registration_id INTO existing_registration_id;

  IF existing_registration_id IS NULL THEN
    UPDATE registration_identity_keys
    SET registration_id = NEW.id
    WHERE webinar_id = NEW.webinar_id
      AND normalized_email = lower(btrim(NEW.email))
      AND registration_id IS NULL
    RETURNING registration_id INTO existing_registration_id;
  END IF;

  IF existing_registration_id IS NULL THEN
    SELECT registration_id INTO existing_registration_id
    FROM registration_identity_keys
    WHERE webinar_id = NEW.webinar_id
      AND normalized_email = lower(btrim(NEW.email));
  END IF;

  IF existing_registration_id <> NEW.id THEN
    RAISE EXCEPTION 'registration email identity already exists' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS registrations_email_identity_trigger ON registrations;
CREATE TRIGGER registrations_email_identity_trigger
AFTER INSERT OR UPDATE OF webinar_id, email ON registrations
FOR EACH ROW EXECUTE FUNCTION enforce_registration_email_identity();

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id varchar NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  event_key text,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  lease_token varchar(64),
  next_attempt_at timestamp NOT NULL DEFAULT now(),
  last_error text,
  delivered_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS lease_token varchar(64);
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS event_key text;
CREATE INDEX IF NOT EXISTS webhook_deliveries_retry_idx
  ON webhook_deliveries (status, next_attempt_at);
CREATE UNIQUE INDEX IF NOT EXISTS webhook_deliveries_event_key_uniq
  ON webhook_deliveries (webhook_id, event_key)
  WHERE event_key IS NOT NULL;

ALTER TABLE email_reminders ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0;
ALTER TABLE email_reminders ADD COLUMN IF NOT EXISTS lease_token varchar(64);
ALTER TABLE email_reminders ADD COLUMN IF NOT EXISTS lease_expires_at timestamp;

CREATE TABLE IF NOT EXISTS ai_credit_revocations (
  idempotency_key text PRIMARY KEY,
  user_id varchar NOT NULL REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ai_response_artifacts (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id varchar UNIQUE REFERENCES ai_credit_reservations(id),
  user_id varchar NOT NULL REFERENCES users(id),
  webinar_id varchar REFERENCES webinars(id),
  kind text NOT NULL,
  request_text text NOT NULL,
  response_text text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS uploaded_assets (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url text NOT NULL UNIQUE,
  filename text NOT NULL UNIQUE,
  created_at timestamp NOT NULL DEFAULT now()
);