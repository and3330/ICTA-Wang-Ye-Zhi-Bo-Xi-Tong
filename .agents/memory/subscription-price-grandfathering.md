---
name: Subscription price grandfathering
description: Billing policy and compatibility rules when changing a subscription plan's price.
---

Starter costs USD 29 per month for new subscriptions. A price change must not silently migrate existing subscribers: their Stripe subscription item remains on its original Price while retaining the same plan entitlement and 100-point paid-renewal gift. Customer-facing current-plan labels must show the actual subscribed amount rather than the latest public catalog price.

**Why:** Stripe recurring Price amounts are immutable, and transferring a lookup key to a replacement Price removes it from the archived Price. Mapping only by the current lookup key would make grandfathered customers lose entitlement or renewal credits; hardcoding the new amount would misrepresent their bill.

**How to apply:** Use price-versioned lookup keys for a price rollout while the previous deployment may still run. Keep previous Prices and lookup keys active until retiring the old deployment is explicitly safe: transferring a key before publishing can break its amount-validated checkout. Never relabel an existing unrelated Product to make it pass entitlement checks. Resolve old subscription items through trusted Stripe catalog identity, validate new Checkout prices by amount/currency/interval, and preserve invoice-based grant idempotency.