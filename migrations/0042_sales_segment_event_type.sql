ALTER TABLE webinar_funnel_events DROP CONSTRAINT IF EXISTS webinar_funnel_events_event_type_check;
ALTER TABLE webinar_funnel_events ADD CONSTRAINT webinar_funnel_events_event_type_check
  CHECK (event_type IN ('landing_view','registration','webinar_enter','video_progress','sales_segment_reached','dropoff','cta_view','cta_click','checkout_start','purchase','refund'));
