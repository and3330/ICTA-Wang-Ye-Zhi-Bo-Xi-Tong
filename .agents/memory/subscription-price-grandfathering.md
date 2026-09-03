---
name: Subscription price grandfathering
description: Billing policy and compatibility rules when changing a subscription plan's price.
---

Starter costs USD 39 per month for new subscriptions. A price change must not silently migrate existing subscribers: their Stripe subscription item remains on its original Price while retaining the same plan entitlement and 100-point paid-renewal gift. Customer-facing current-plan labels must show the actual subscribed amount rather than the latest public catalog price.

**Why:** Stripe recurring Price amounts are immutable, and transferring a lookup key to a replacement Price removes it from the archived Price. Mapping only by the current lookup key would make grandfathered customers lose entitlement or renewal credits; hardcoding the new amount would misrepresent their bill.

**How to apply:** Create a replacement recurring Price, transfer the approved lookup key, and archive the previous Price. Resolve archived subscription items through trusted Stripe product catalog metadata, validate new Checkout prices by amount/currency/interval, and preserve invoice-based grant idempotency.