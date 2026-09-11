---
name: Subscription publication entitlement
description: Durable rules for separating free draft access from Stripe-backed publishing rights.
---

Free accounts may create, edit, retain, and owner-preview drafts. Public access and publication require an active entitlement from Stripe-approved recurring prices or an explicitly audited, time-bounded administrative grant; returning from Checkout must never grant access by itself.

**Why:** Client-controlled price IDs, redirect-based activation, or check-then-publish quota logic can grant the wrong capacity, activate unpaid accounts, or exceed a plan during concurrent requests. Draft protection must also cover WebSocket and child-resource access, not only the main page.

An `active` or `trialing` Stripe status grants publishing only while its current period has not ended. `cancel_at_period_end` does not revoke access early; `past_due`, `canceled`, `expired`, or a reached period end blocks new publication while preserving existing content.

**How to apply:** Resolve plan capacity from stable approved Stripe price lookup keys, preserve explicit legacy price mappings until those subscriptions migrate, treat webhook/backfill plus Stripe state as authoritative, preserve canceled content and lifecycle history, and serialize each account's count-and-publish transition in one database transaction.

Administrative plan/time adjustments are non-payment grants, not edits to Stripe billing. Compose their active capacities with paid and temporary-capacity entitlements using the maximum, never the latest expiry or last-written grant. Extending expired access starts from the later of now and its former expiry.

**Why:** Support needs to grant or extend member access without charging members, deferring real renewal charges, fabricating paid/trial status, granting invoice-funded AI points, or accidentally reducing existing paid rights.

**How to apply:** Keep effective access and actual paid billing separately labeled throughout management and member dashboards. Manual expiry must never appear as a Stripe renewal date. Future starts, expiry, and revocation apply at every public admission; manual grants do not qualify for automatic paid AI gifts.