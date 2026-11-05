# Public webinar response fields

Public webinar data is available through:

- Anonymous `GET /api/webinars`: an array of published webinars whose owners
  have a current public-access entitlement.
- `GET /api/webinars/:id`: a public webinar object for viewers. Unavailable
  webinars return `404`. Authenticated owners and active super-administrators
  can access the management object, including private settings.
- `GET /api/webinars/:id/landing-page`: a response with `webinar`, `landingPage`,
  `mediaPlayback`, and `preview: false`. Its `webinar` always uses the public
  fields, even for a signed-in owner. Missing public landing pages or owner
  entitlements return `404`; unavailable secure playback returns `503`.

The public webinar object includes only these approved fields:

```text
id, title, description, videoProvider, coverImage, startTime, status,
publishStatus, videoDuration, scheduleMode, recurringSchedule, timezone,
brandSettings, customFields, scarcitySettings, thankYouSettings,
replaySettings, replayEnabled, replayAvailableHours, metaPixelId, gtmContainerId
```

Dates serialize as JSON strings; optional database values can be `null`.
Tracking identifiers are validated before returning them; invalid legacy values
are returned as `null`.

Host notification settings (including the notification email address), email
campaign settings/templates, AI settings, raw video source/asset identifiers,
owner account identifiers, and internal timestamps are not public response
fields. New database fields are private by default.

The authenticated owner's `GET /api/webinars` list and owner-authorized
`GET /api/webinars/:id/landing-page/preview` retain management settings.
