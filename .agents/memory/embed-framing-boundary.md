---
name: Embedded page framing boundary
description: Owner-approved external framing scope and cookie-free registration constraint.
---

Only `/embed/register/*` and `/embed/webinar/*` may be framed by the explicitly approved NoncodingAI origins. Do not expand that permission to `/form/*`, `/register/*`, the homepage, or OAuth pages. Preserve stricter OAuth framing restrictions and other pages' existing X-Frame-Options.

**Why:** The user explicitly requested external iframe integration on those two embed namespaces only, with a fixed platform-approved origin list rather than a per-webinar configuration prerequisite.

**How to apply:** Apply the policy to the actual server HTML response, including SPA fallback responses. Treat framing permission separately from publication/access checks and postMessage destination authorization. Embedded registration must work without third-party cookies; storage restrictions must not turn a server-accepted registration into an apparent failure.

Viewer navigation after registration must explicitly carry the newly issued watch credential, including when opening a separate tab. Browser storage is only a convenience cache.

**Why:** A `noopener` new tab does not inherit the iframe's session storage, and mobile privacy settings may reject storage entirely. A valid registration must not become an unavailable viewer merely because the browsing context changed.

**How to apply:** Preserve the credential from the current registration response for its success-page navigation; never fall back to a prior registration's cached credential. Keep token validation and webinar/session ownership checks in place.
