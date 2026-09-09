CREATE INDEX IF NOT EXISTS webinar_funnel_events_webinar_registration_idx
  ON webinar_funnel_events (webinar_id, registration_id);