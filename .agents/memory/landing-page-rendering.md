---
name: Landing page rendering rules
description: Shared renderer for public webinar landing pages and the editor preview; what the renderer may and may not add on its own.
---
- Public `/register/:id` (redirected to `/form/:id` by the server) and the Landing Studio preview must render through ONE shared component so the preview matches published output. The preview root carries both `webinar-landing` and `landing-preview` classes; layout responds to the container width (container queries placed after base rules), not the viewport.
- The renderer must never invent member-facing claims (price, "免費", duration, outcomes, "限定對象"). Only block data plus neutral labels; event date shown only for fixed-schedule webinars.
- Reference look requested by the owner (Sept 2026): dfp.com.tw style — solid deep primary hero, secondary colour only for the headline's second clause, buttons and eyebrows. Never a primary→secondary full-bleed gradient.
- Dev e2e for the public page must navigate to `/form/<mocked-id>`; `/register/<id>` is answered by the server (404 for unknown webinars) before the SPA loads.
- Headless Chromium in this workspace lacks CJK fonts; install Noto Sans TC into ~/.fonts before judging Chinese typography in screenshots.
