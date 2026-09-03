---
name: Annual billing credits
description: Pricing, monthly AI gift, idempotency, and refund rules for annual subscriptions.
---

Annual subscriptions charge 85% of twelve monthly payments upfront. Their plan limits remain monthly, and AI gifts release at each subscription-month anniversary rather than all at once. A zero-dollar trial invoice is not payment; the first gift requires a real non-zero paid annual invoice.

**Why:** Annual Stripe subscriptions produce one invoice per year, so an invoice-only gift mechanism would issue one month of points for the whole year. Releasing all twelve months upfront would also leave unearned credits after an early full refund.

**How to apply:** Anchor gifts to the Stripe subscription period and use a unique subscription-period-month key. Persist the subscription ID from the verified invoice webhook so scheduling does not depend on a browser return. Before every grant or refund reconciliation, verify remaining paid Charge value while holding the same per-user credit lock. A full refund revokes unused gifts for that invoice period and blocks future releases even if the subscription is canceled or expired; partial refunds retain eligibility.