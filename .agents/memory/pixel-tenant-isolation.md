---
name: Pixel tenant isolation
description: Why platform and webinar pixels need explicit event routing in the same browser session.
---

Platform marketing and member webinar pixels must never share broadcast events. The platform pixel base code is in the HTML head on every page. The owner explicitly requested removing the consent dialog site-wide and enabling organizer Meta Pixel, GTM, and existing conversions by default, including visitors with an old denied choice or unavailable storage. This is a product policy, not evidence of visitor consent. Explicit platform signup and paid-checkout conversions may run on authenticated platform pages, but never on member webinar pages.

**Why:** SPA navigation preserves Meta's initialized pixels after a visitor leaves the homepage. A later generic tracking call can send member webinar activity to the platform pixel even though its React component no longer tracks that route.

**How to apply:** Use pixel-specific event dispatch for both platform and webinar events and keep automatic events disabled. Do not restore a consent dialog, old denied-storage gating, or a global Meta consent-revoke switch without a new product decision. Preserve paid-only confirmation and event-ID deduplication. Test marketing-to-webinar navigation in the same document rather than only isolated page loads. The unconditional noscript image is intentional for the platform pixel only; never add one for member pixels.

Deferred platform conversions must use the freshly authenticated account, not a perpetually fresh query-cache identity.

**Why:** SPA logout/login can retain the previous account's cached identity, causing a later conversion flush to report the previous person's conversion.

**How to apply:** Clear account-scoped caches at authentication boundaries and test account switching without a page reload, including queued or retried conversions after switching.