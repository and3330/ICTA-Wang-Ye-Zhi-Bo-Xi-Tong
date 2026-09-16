---
name: Pixel tenant isolation
description: Why platform and webinar pixels need explicit event routing in the same browser session.
---

Platform marketing and member webinar pixels must never share broadcast events. The platform pixel base code is in the HTML head on every page and does not wait for cookie consent (owner decision, Sept 2026, so Meta's setup checker detects it); only platform conversions, member pixels and GTM are consent-gated. Because the platform pixel is always live, the global fbq consent revoke switch cannot be used; automatic events are disabled for every pixel and member events are gated per call instead. Explicit platform signup and paid-checkout conversions may run on authenticated platform pages, but never on member webinar pages.

**Why:** SPA navigation preserves Meta's initialized pixels after a visitor leaves the homepage. A later generic tracking call can send member webinar activity to the platform pixel even though its React component no longer tracks that route.

**How to apply:** Use pixel-specific event dispatch for both platform and webinar events, retain consent gating, and test marketing-to-webinar navigation in the same document rather than only isolated page loads. The unconditional noscript image is intentional for the platform pixel only; never add one for member pixels.

Deferred platform conversions must use the freshly authenticated account, not a perpetually fresh query-cache identity.

**Why:** SPA logout/login can retain the previous account's cached identity, causing a later consent grant to report the previous person's conversion.

**How to apply:** Clear account-scoped caches at authentication boundaries and test account switching without a page reload, including consent granted after switching.