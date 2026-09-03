---
name: AI credit expiry
description: Business rules for monthly subscription gifts, purchased credits, expiry, and consumption order.
---

Subscription plans grant AI credits once for the initial successful payment and once for each successful monthly renewal: Starter 100, Growth 200, Scale 300. Each gifted batch expires one calendar year after it is granted. Separately purchased credits never expire. Credit consumption must use the earliest-expiring active gift batches before permanent credits.

**Why:** The user confirmed that only plan-gifted credits expire; purchased credits must retain their paid value indefinitely. Keeping monthly gifts as separate batches is required to apply the one-year expiry correctly.

**How to apply:** Any future grant, debit, refund, balance display, or reporting feature must preserve batch identity, make subscription invoice grants idempotent, and refund the exact reserved batches rather than adding generic permanent credits.