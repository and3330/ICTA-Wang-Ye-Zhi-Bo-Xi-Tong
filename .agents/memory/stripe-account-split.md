---
name: Stripe account split
description: Records which Stripe access path owns the live ICTA Webinar billing catalog.
---

The workspace Stripe connector and the application’s configured live Stripe client target different Stripe accounts. For ICTA Webinar products, prices, lookup keys, and checkout catalog changes, use the application’s Stripe client and its idempotent catalog synchronization path. Do not mutate the catalog through the workspace connector.

**Why:** A Scale product and price created through the workspace connector were invisible to the application and returned `resource_missing` when retrieved through the app client. The mistaken connector-side objects were archived, then the catalog was synchronized through the app client.

**How to apply:** Before any future billing catalog mutation, read and verify with the same app Stripe client used by checkout. The workspace connector can only be trusted for this catalog after an explicit account-identity reconciliation.