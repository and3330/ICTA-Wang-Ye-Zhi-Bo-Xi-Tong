-- No-card trial commerce is a lead-generation surface. It is additive: rows
-- survive expiration and can become visible again once a paid entitlement is
-- active, without recreating a URL or changing the published sales snapshot.
CREATE TABLE IF NOT EXISTS trial_commerce_pages (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id varchar NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  offer_id varchar NOT NULL REFERENCES webinar_offers(id) ON DELETE RESTRICT,
  sales_page_id varchar NOT NULL REFERENCES offer_sales_pages(id) ON DELETE RESTRICT,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS trial_commerce_pages_owner_uniq ON trial_commerce_pages(owner_id);
CREATE UNIQUE INDEX IF NOT EXISTS trial_commerce_pages_offer_uniq ON trial_commerce_pages(offer_id);
CREATE UNIQUE INDEX IF NOT EXISTS trial_commerce_pages_sales_page_uniq ON trial_commerce_pages(sales_page_id);

CREATE TABLE IF NOT EXISTS trial_commerce_leads (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  trial_commerce_page_id varchar NOT NULL REFERENCES trial_commerce_pages(id) ON DELETE RESTRICT,
  owner_id varchar NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  sales_page_id varchar NOT NULL REFERENCES offer_sales_pages(id) ON DELETE RESTRICT,
  name text NOT NULL,
  email text NOT NULL,
  normalized_email text NOT NULL,
  consented_at timestamp NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS trial_commerce_leads_page_email_uniq
  ON trial_commerce_leads(trial_commerce_page_id, normalized_email);
CREATE INDEX IF NOT EXISTS trial_commerce_leads_owner_created_idx
  ON trial_commerce_leads(owner_id, created_at);

CREATE TABLE IF NOT EXISTS trial_commerce_view_events (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  trial_commerce_page_id varchar NOT NULL REFERENCES trial_commerce_pages(id) ON DELETE RESTRICT,
  owner_id varchar NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  sales_page_id varchar NOT NULL REFERENCES offer_sales_pages(id) ON DELETE RESTRICT,
  visitor_token_hash varchar(64) NOT NULL,
  dedupe_key varchar(64) NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS trial_commerce_view_events_page_dedupe_uniq
  ON trial_commerce_view_events(trial_commerce_page_id, dedupe_key);
CREATE INDEX IF NOT EXISTS trial_commerce_view_events_owner_created_idx
  ON trial_commerce_view_events(owner_id, created_at);
CREATE INDEX IF NOT EXISTS trial_commerce_view_events_page_visitor_idx
  ON trial_commerce_view_events(trial_commerce_page_id, visitor_token_hash);