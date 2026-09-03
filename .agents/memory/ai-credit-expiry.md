---
name: AI credit expiry
description: Business rules for monthly subscription gifts, purchased credits, expiry, and consumption order.
---

Free accounts start with zero AI points. New customers may receive one seven-day paid-plan trial, but the trial itself grants no AI points; AI use during the trial requires separately purchased points. Subscription plans grant AI credits only after the first positive payment and after each successful monthly renewal: Starter 100, Growth 200, Scale 300. Each gifted batch expires one calendar year after it is granted. Separately purchased credits never expire. Credit consumption must use the earliest-expiring active gift batches before permanent credits.

**Why:** The user confirmed that free and trial access should not include AI credits, and that only plan-gifted credits expire; purchased credits must retain their paid value indefinitely. Keeping monthly gifts as separate batches is required to apply the one-year expiry correctly.

**How to apply:** AI entry points must prompt zero-balance users to buy points. Future grant, debit, refund, balance, trial, or reporting work must preserve batch identity, grant only on positive subscription invoices, prevent repeated trials, and refund exact reserved batches.