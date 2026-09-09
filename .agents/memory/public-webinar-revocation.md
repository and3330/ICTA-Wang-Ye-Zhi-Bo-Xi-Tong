---
name: Public webinar revocation
description: Continuous access-revocation rules for public webinar viewing and interaction surfaces.
---

Public webinar access is a continuously evaluated capability, not a one-time admission check. Subscription entitlement, publication state, registration scope, session start, and replay deadline must agree across HTTP APIs, WebSocket actions, and the browser’s active player.

**Why:** Join-only checks can correctly close chat while leaving an already loaded video iframe playable after unpublishing, subscription expiry, or replay expiry.

**How to apply:** Revalidate long-lived connections and active playback periodically and on actions. Authorization-related failures must remove playback, not only stop auxiliary APIs. Keep privileged owner/super-admin previews explicit and separate from public-viewer rules.