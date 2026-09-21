---
name: Course marketplace moderation
description: Rules that prevent approved directory listings from exposing later, unreviewed webinar content.
---

Course marketplace approval applies to the public webinar content that an administrator reviewed, not permanently to the webinar ID. Any mutation that changes registration, schedule, replay, landing-page, video, branding, scarcity, thank-you, or AI-visible content must return an opted-in approved listing to pending. Publishing or republishing does the same.

**Why:** A listing can keep an approved card snapshot while linking to a registration or webinar experience that has changed. Without invalidation, an owner could expose unreviewed content after approval; separate publication and moderation statements also allow an approval/republish race.

**How to apply:** Serialize owner submission, moderation review, webinar publication, landing publication, and public-content changes with the same per-webinar transaction lock. Re-read eligibility and published content inside the locked review transaction, and commit approval plus audit atomically.