---
name: Stripe archived lookup keys
description: How to recover a subscription plan whose Stripe Price or Product was archived.
---

An inactive Stripe Price can retain ownership of its lookup key even though an active-only catalog query reports the plan as missing. If creating the replacement fails because the lookup key is already in use, retrieve the owning Price and inspect it rather than changing the lookup key.

**Why:** Creating another Price with the same lookup key is rejected, while assigning a different lookup key would break the application's approved-price mapping. Reactivating is safe only when the existing amount, currency, recurrence, and product identity all match the intended plan.

**How to apply:** Check the app's live Stripe client rather than the workspace development connector. Verify the archived Price and Product fields, reactivate both, then confirm the production config reports the full catalog as ready.