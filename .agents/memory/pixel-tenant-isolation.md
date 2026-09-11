---
name: Pixel tenant isolation
description: Why platform and webinar pixels need explicit event routing in the same browser session.
---

Platform marketing and member webinar pixels must never share broadcast events. Restrict the platform pixel to opted-in marketing routes and disable its automatic events.

**Why:** SPA navigation preserves Meta's initialized pixels after a visitor leaves the homepage. A later generic tracking call can send member webinar activity to the platform pixel even though its React component no longer tracks that route.

**How to apply:** Use pixel-specific event dispatch for both platform and webinar events, retain consent gating, and test marketing-to-webinar navigation in the same document rather than only isolated page loads. Do not add an unconditional noscript tracking image, which would bypass consent.