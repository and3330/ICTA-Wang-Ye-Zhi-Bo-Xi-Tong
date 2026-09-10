ALTER TABLE "media_assets" ADD COLUMN IF NOT EXISTS "deleting_at" timestamp;
CREATE TABLE IF NOT EXISTS "deleted_media_urls" (
  "url" text PRIMARY KEY,
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "deleted_at" timestamp NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION validate_owned_media_urls(owner_id varchar, payload text) RETURNS void AS $$
DECLARE candidate media_assets%ROWTYPE;
BEGIN
  IF owner_id IS NULL OR payload IS NULL THEN RETURN; END IF;
  FOR candidate IN
    SELECT * FROM media_assets m
    WHERE m.user_id = owner_id AND m.url IS NOT NULL AND position(m.url in payload) > 0
    FOR KEY SHARE
  LOOP
    IF candidate.deleting_at IS NOT NULL OR candidate.status <> 'ready' THEN
      RAISE EXCEPTION 'invalid or deleting media URL reference' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM deleted_media_urls d
    WHERE d.user_id = owner_id AND position(d.url in payload) > 0
  ) THEN
    RAISE EXCEPTION 'deleted media URL reference' USING ERRCODE = '23514';
  END IF;
END;
$$ LANGUAGE plpgsql;

-- These triggers close the check/delete race for webinar and landing-page
-- references. A writer takes a row lock on every referenced Bunny asset and
-- rejects assets already fenced for deletion.
CREATE OR REPLACE FUNCTION validate_webinar_media_reference() RETURNS trigger AS $$
BEGIN
  PERFORM validate_owned_media_urls(NEW.user_id, concat_ws(' ', NEW.cover_image, NEW.brand_settings::text));
  IF NEW.video_provider = 'bunny' THEN
    IF NEW.video_asset_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM media_assets m
      WHERE m.id = NEW.video_asset_id
        AND m.user_id = NEW.user_id
        AND m.kind = 'video'
        AND m.status = 'ready'
        AND m.deleting_at IS NULL
      FOR KEY SHARE
    ) THEN
      RAISE EXCEPTION 'invalid or deleting webinar media reference' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS webinars_media_reference_guard ON webinars;
CREATE TRIGGER webinars_media_reference_guard
BEFORE INSERT OR UPDATE OF video_provider, video_asset_id, user_id ON webinars
FOR EACH ROW EXECUTE FUNCTION validate_webinar_media_reference();

CREATE OR REPLACE FUNCTION validate_landing_media_references() RETURNS trigger AS $$
DECLARE
  owner_id varchar;
  candidate jsonb;
  asset_id varchar;
BEGIN
  SELECT user_id INTO owner_id FROM webinars WHERE id = NEW.webinar_id;
  PERFORM validate_owned_media_urls(owner_id, concat_ws(' ', NEW.blocks::text, NEW.published_blocks::text));
  FOREACH candidate IN ARRAY ARRAY[NEW.blocks, NEW.published_blocks]
  LOOP
    IF candidate IS NULL THEN CONTINUE; END IF;
    FOR asset_id IN
      SELECT block->>'videoId'
      FROM jsonb_array_elements(candidate) block
      WHERE block->>'type' = 'video' AND block->>'provider' = 'bunny'
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM media_assets m
        WHERE m.id::text = asset_id
          AND m.user_id = owner_id
          AND m.kind = 'video'
          AND m.status = 'ready'
          AND m.deleting_at IS NULL
        FOR KEY SHARE
      ) THEN
        RAISE EXCEPTION 'invalid or deleting landing media reference' USING ERRCODE = '23514';
      END IF;
    END LOOP;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS webinar_landing_media_reference_guard ON webinar_landing_pages;
CREATE TRIGGER webinar_landing_media_reference_guard
BEFORE INSERT OR UPDATE OF blocks, published_blocks, webinar_id ON webinar_landing_pages
FOR EACH ROW EXECUTE FUNCTION validate_landing_media_references();

CREATE OR REPLACE FUNCTION validate_sales_page_media_references() RETURNS trigger AS $$
DECLARE owner_id varchar;
BEGIN
  owner_id := NEW.user_id;
  IF owner_id IS NULL AND NEW.webinar_id IS NOT NULL THEN
    SELECT user_id INTO owner_id FROM webinars WHERE id = NEW.webinar_id;
  END IF;
  PERFORM validate_owned_media_urls(owner_id, concat_ws(' ', NEW.ordered_blocks::text, NEW.published_ordered_blocks::text));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS offer_sales_page_media_reference_guard ON offer_sales_pages;
CREATE TRIGGER offer_sales_page_media_reference_guard
BEFORE INSERT OR UPDATE OF ordered_blocks, published_ordered_blocks, user_id, webinar_id ON offer_sales_pages
FOR EACH ROW EXECUTE FUNCTION validate_sales_page_media_references();

CREATE OR REPLACE FUNCTION validate_fake_user_media_references() RETURNS trigger AS $$
DECLARE owner_id varchar;
BEGIN
  SELECT user_id INTO owner_id FROM webinars WHERE id = NEW.webinar_id;
  PERFORM validate_owned_media_urls(owner_id, NEW.avatar);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS fake_user_media_reference_guard ON fake_users;
CREATE TRIGGER fake_user_media_reference_guard
BEFORE INSERT OR UPDATE OF avatar, webinar_id ON fake_users
FOR EACH ROW EXECUTE FUNCTION validate_fake_user_media_references();