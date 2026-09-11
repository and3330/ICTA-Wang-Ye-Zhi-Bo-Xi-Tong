CREATE TABLE IF NOT EXISTS external_journey_settings (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  webinar_id varchar NOT NULL UNIQUE REFERENCES webinars(id) ON DELETE CASCADE,
  settings jsonb NOT NULL,
  published_settings jsonb,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  published_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS member_integration_secrets (
  user_id varchar PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret_encrypted text NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  rotated_at timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS external_handoffs (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(), token_hash varchar(64) NOT NULL UNIQUE,
  webinar_id varchar NOT NULL REFERENCES webinars(id) ON DELETE CASCADE,
  owner_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  registration_id varchar NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  destination_origin text NOT NULL, include_watch_link boolean NOT NULL DEFAULT false, watch_url_encrypted text,
  expires_at timestamp NOT NULL, used_at timestamp, created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS external_handoffs_expires_idx ON external_handoffs(expires_at);
CREATE TABLE IF NOT EXISTS external_referrals (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(), token_hash varchar(64) NOT NULL UNIQUE,
  webinar_id varchar NOT NULL REFERENCES webinars(id) ON DELETE CASCADE,
  owner_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cta_id varchar REFERENCES cta_buttons(id) ON DELETE CASCADE, target_url text NOT NULL,
  registration_id varchar REFERENCES registrations(id) ON DELETE SET NULL, session_id varchar REFERENCES webinar_sessions(id) ON DELETE SET NULL, selected_session timestamp,
  session_provenance text NOT NULL DEFAULT 'anonymous' CHECK (session_provenance IN ('registered_watch_token','declared_session','anonymous')), visit_hash varchar(64),
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS external_orders (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(), owner_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  webinar_id varchar NOT NULL REFERENCES webinars(id) ON DELETE CASCADE, session_id varchar REFERENCES webinar_sessions(id) ON DELETE SET NULL, selected_session timestamp, order_id text NOT NULL,
  currency varchar(3) NOT NULL, source_trust text NOT NULL CHECK (source_trust IN ('browser_reported','merchant_reported')),
  gross_paid_minor integer NOT NULL DEFAULT 0, refunded_minor integer NOT NULL DEFAULT 0, net_minor integer NOT NULL DEFAULT 0,
  referral_id varchar REFERENCES external_referrals(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT external_orders_owner_order_uniq UNIQUE(owner_id, order_id)
);
CREATE INDEX IF NOT EXISTS external_orders_owner_created_idx ON external_orders(owner_id, created_at);
CREATE TABLE IF NOT EXISTS external_order_events (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(), owner_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  webinar_id varchar NOT NULL REFERENCES webinars(id) ON DELETE CASCADE, session_id varchar REFERENCES webinar_sessions(id) ON DELETE SET NULL, selected_session timestamp, order_id text NOT NULL, event_id text NOT NULL,
  event_type text NOT NULL, source_trust text NOT NULL CHECK (source_trust IN ('browser_reported','merchant_reported')),
  amount_minor integer NOT NULL, currency varchar(3) NOT NULL, payload_fingerprint varchar(64) NOT NULL,
  referral_id varchar REFERENCES external_referrals(id) ON DELETE SET NULL,
  occurred_at timestamp NOT NULL DEFAULT now(), created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT external_order_events_owner_event_uniq UNIQUE(owner_id, event_id)
);
CREATE INDEX IF NOT EXISTS external_order_events_owner_order_idx ON external_order_events(owner_id, order_id);