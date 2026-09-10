-- Promote products, sales pages, and orders to member-owned resources. Owner
-- columns intentionally remain nullable because Publish applies schema DDL
-- without data backfills. Application authorization resolves old rows through
-- their linked offer/webinar and fails closed when no authentic owner exists.
ALTER TABLE webinar_offers ADD COLUMN IF NOT EXISTS user_id varchar;
ALTER TABLE offer_sales_pages ADD COLUMN IF NOT EXISTS user_id varchar;
ALTER TABLE webinar_payments ADD COLUMN IF NOT EXISTS user_id varchar;
ALTER TABLE webinar_funnel_events ADD COLUMN IF NOT EXISTS user_id varchar;

UPDATE webinar_offers offer
SET user_id = webinar.user_id
FROM webinars webinar
JOIN users owner ON owner.id = webinar.user_id
WHERE offer.webinar_id = webinar.id
  AND offer.user_id IS NULL;

UPDATE offer_sales_pages page
SET user_id = offer.user_id
FROM webinar_offers offer
JOIN users owner ON owner.id = offer.user_id
WHERE page.offer_id = offer.id
  AND page.user_id IS NULL;

UPDATE webinar_payments payment
SET user_id = offer.user_id
FROM webinar_offers offer
JOIN users owner ON owner.id = offer.user_id
WHERE payment.offer_id = offer.id
  AND payment.user_id IS NULL;

UPDATE webinar_funnel_events event
SET user_id = webinar.user_id
FROM webinars webinar
JOIN users owner ON owner.id = webinar.user_id
WHERE webinar.id = event.webinar_id
  AND event.user_id IS NULL;

UPDATE webinar_funnel_events event
SET user_id = offer.user_id
FROM webinar_offers offer
JOIN users owner ON owner.id = offer.user_id
WHERE event.offer_id = offer.id
  AND event.user_id IS NULL;

-- A prior schema-only preview may have left owner values without a valid user.
-- They cannot establish tenancy and must remain unresolved rather than blocking
-- the nullable FK or being mapped to a fabricated account.
UPDATE webinar_offers resource SET user_id = NULL
WHERE user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users owner WHERE owner.id = resource.user_id);
UPDATE offer_sales_pages resource SET user_id = NULL
WHERE user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users owner WHERE owner.id = resource.user_id);
UPDATE webinar_payments resource SET user_id = NULL
WHERE user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users owner WHERE owner.id = resource.user_id);
UPDATE webinar_funnel_events resource SET user_id = NULL
WHERE user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users owner WHERE owner.id = resource.user_id);

ALTER TABLE webinar_offers DROP CONSTRAINT IF EXISTS webinar_offers_user_id_users_id_fk;
ALTER TABLE webinar_offers
  ADD CONSTRAINT webinar_offers_user_id_users_id_fk
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE offer_sales_pages DROP CONSTRAINT IF EXISTS offer_sales_pages_user_id_users_id_fk;
ALTER TABLE offer_sales_pages
  ADD CONSTRAINT offer_sales_pages_user_id_users_id_fk
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE webinar_payments DROP CONSTRAINT IF EXISTS webinar_payments_user_id_users_id_fk;
ALTER TABLE webinar_payments
  ADD CONSTRAINT webinar_payments_user_id_users_id_fk
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE webinar_funnel_events DROP CONSTRAINT IF EXISTS webinar_funnel_events_user_id_users_id_fk;
ALTER TABLE webinar_funnel_events
  ADD CONSTRAINT webinar_funnel_events_user_id_users_id_fk
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS webinar_offers_user_idx ON webinar_offers(user_id);
CREATE INDEX IF NOT EXISTS offer_sales_pages_user_idx ON offer_sales_pages(user_id);

-- Webinar is now optional attribution. Remove whichever FK name was produced
-- by the historical inline/table migration before adding the stable SET NULL FK.
DO $$
DECLARE item record;
BEGIN
  FOR item IN
    SELECT c.conrelid::regclass AS table_name, c.conname
    FROM pg_constraint c
    WHERE c.contype = 'f'
      AND c.confrelid = 'webinars'::regclass
      AND c.conrelid IN (
        'webinar_offers'::regclass,
        'offer_sales_pages'::regclass,
        'webinar_payments'::regclass,
        'webinar_funnel_events'::regclass
      )
      AND c.conkey = ARRAY[
        (SELECT a.attnum FROM pg_attribute a
         WHERE a.attrelid = c.conrelid AND a.attname = 'webinar_id')
      ]::smallint[]
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', item.table_name, item.conname);
  END LOOP;
END $$;

ALTER TABLE webinar_offers ALTER COLUMN webinar_id DROP NOT NULL;
ALTER TABLE offer_sales_pages ALTER COLUMN webinar_id DROP NOT NULL;
ALTER TABLE webinar_payments ALTER COLUMN webinar_id DROP NOT NULL;
ALTER TABLE webinar_funnel_events ALTER COLUMN webinar_id DROP NOT NULL;

ALTER TABLE webinar_offers ADD CONSTRAINT webinar_offers_webinar_id_webinars_id_fk
  FOREIGN KEY (webinar_id) REFERENCES webinars(id) ON DELETE SET NULL;
ALTER TABLE offer_sales_pages ADD CONSTRAINT offer_sales_pages_webinar_id_webinars_id_fk
  FOREIGN KEY (webinar_id) REFERENCES webinars(id) ON DELETE SET NULL;
ALTER TABLE webinar_payments ADD CONSTRAINT webinar_payments_webinar_id_webinars_id_fk
  FOREIGN KEY (webinar_id) REFERENCES webinars(id) ON DELETE SET NULL;
ALTER TABLE webinar_funnel_events ADD CONSTRAINT webinar_funnel_events_webinar_id_webinars_id_fk
  FOREIGN KEY (webinar_id) REFERENCES webinars(id) ON DELETE SET NULL;

ALTER TABLE offer_sales_pages ADD COLUMN IF NOT EXISTS deleted_at timestamp;
ALTER TABLE offer_sales_pages DROP CONSTRAINT IF EXISTS offer_sales_pages_offer_uniq;
DROP INDEX IF EXISTS offer_sales_pages_offer_uniq;
CREATE UNIQUE INDEX offer_sales_pages_offer_uniq
  ON offer_sales_pages(offer_id) WHERE deleted_at IS NULL;

ALTER TABLE cta_buttons ADD COLUMN IF NOT EXISTS sales_page_id varchar;
ALTER TABLE cta_buttons ADD COLUMN IF NOT EXISTS live_only boolean NOT NULL DEFAULT false;
ALTER TABLE cta_buttons ADD COLUMN IF NOT EXISTS expires_at timestamp;
CREATE INDEX IF NOT EXISTS cta_buttons_live_expiry_idx
  ON cta_buttons(webinar_id, expires_at) WHERE live_only = true;
ALTER TABLE cta_buttons DROP CONSTRAINT IF EXISTS cta_buttons_sales_page_id_offer_sales_pages_id_fk;
ALTER TABLE cta_buttons
  ADD CONSTRAINT cta_buttons_sales_page_id_offer_sales_pages_id_fk
  FOREIGN KEY (sales_page_id) REFERENCES offer_sales_pages(id) ON DELETE RESTRICT;
-- Historical offer links treated offer_id as authoritative even if an old
-- client redundantly sent a URL.
UPDATE cta_buttons SET url = NULL WHERE offer_id IS NOT NULL;
ALTER TABLE cta_buttons DROP CONSTRAINT IF EXISTS cta_buttons_destination_check;
ALTER TABLE cta_buttons ADD CONSTRAINT cta_buttons_destination_check CHECK (
  ((url IS NOT NULL)::integer + (offer_id IS NOT NULL)::integer + (sales_page_id IS NOT NULL)::integer) = 1
);

ALTER TABLE webinar_funnel_events ADD COLUMN IF NOT EXISTS sales_page_id varchar;
ALTER TABLE webinar_funnel_events DROP CONSTRAINT IF EXISTS webinar_funnel_events_sales_page_id_offer_sales_pages_id_fk;
ALTER TABLE webinar_funnel_events
  ADD CONSTRAINT webinar_funnel_events_sales_page_id_offer_sales_pages_id_fk
  FOREIGN KEY (sales_page_id) REFERENCES offer_sales_pages(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS webinar_funnel_events_offer_dedupe_uniq
  ON webinar_funnel_events(offer_id, dedupe_key)
  WHERE webinar_id IS NULL AND offer_id IS NOT NULL;

ALTER TABLE webinar_payments ADD COLUMN IF NOT EXISTS created_at timestamp;
UPDATE webinar_payments SET created_at = COALESCE(purchased_at, updated_at, now())
WHERE created_at IS NULL;
ALTER TABLE webinar_payments ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE webinar_payments ALTER COLUMN created_at SET NOT NULL;