---
name: Autoscale startup probe
description: Production startup ordering required to avoid Replit publish health-check timeouts.
---

Bind the public HTTP port before running development migrations, Stripe backfills, webhook reconciliation, or other provider initialization. While booting, let `GET /` return 200 for the publishing probe and return 503 for normal application traffic until setup finishes. Production application schema changes belong to Publish, not startup.

**Why:** Replit publishing can fail with “required port was never opened” even when the build succeeds, because provider setup may consume the entire startup window before the server begins listening.

**How to apply:** Preserve the user's current deployment target and production run command; consult live deployment metadata rather than assuming Autoscale. Any new blocking startup work belongs behind the startup traffic gate, after the listener is active; fatal initialization errors must still terminate the process.