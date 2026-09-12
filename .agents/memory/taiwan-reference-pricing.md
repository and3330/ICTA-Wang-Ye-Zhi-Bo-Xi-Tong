---
name: Taiwan reference pricing
description: Why local-currency subscription display must remain separate from actual billing.
---

Taiwan subscription prices are owner-selected approximate TWD references, not live exchange-rate results or TWD billing amounts. All subscription checkout remains USD. Existing subscribers must see their actual contracted bill rather than a reference for new subscriptions.

**Why:** The user explicitly chose display-only localization and supplied reference amounts. Automatically replacing these with a live FX calculation or creating TWD Stripe prices would change that business decision.

**How to apply:** Determine the display region from the visiting IP, not interface language or browser time zone. Show the actual USD charge alongside the approximate TWD price and explain that bank exchange rates and fees determine the charge. Apply the existing annual discount consistently, and keep IP-derived responses out of shared caches.