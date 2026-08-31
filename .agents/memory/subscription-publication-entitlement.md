---
name: Subscription publication entitlement
description: Durable rules for separating free draft access from Stripe-backed publishing rights.
---

Free accounts may create, edit, retain, and owner-preview drafts. Public access and publication require an active entitlement derived from Stripe-approved recurring prices; returning from Checkout must never grant access by itself.

**Why:** Client-controlled price IDs, redirect-based activation, or check-then-publish quota logic can grant the wrong capacity, activate unpaid accounts, or exceed a plan during concurrent requests. Draft protection must also cover WebSocket and child-resource access, not only the main page.

**How to apply:** Resolve plan capacity from stable approved Stripe price lookup keys, preserve explicit legacy price mappings until those subscriptions migrate, treat webhook/backfill plus Stripe state as authoritative, preserve canceled content and lifecycle history, and serialize each account's count-and-publish transition in one database transaction.