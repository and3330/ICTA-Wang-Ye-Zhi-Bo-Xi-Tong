---
name: AI credit expiry
description: Business rules for monthly subscription gifts, purchased credits, expiry, and consumption order.
---

Free accounts start with zero AI points. New customers may receive one paid-plan trial, but the trial itself grants no AI points; AI use during the trial requires separately purchased points. Changes to the new-customer trial duration apply prospectively, not by modifying existing trial end dates or resetting trial eligibility. A trialing customer may explicitly end the trial early and pay immediately; only the resulting positive paid invoice grants the plan credits. Subscription plans grant AI credits after that first positive payment and after each successful monthly renewal: Starter 100, Growth 200, Scale 300. Each gifted batch expires one calendar year after it is granted. Separately purchased credits never expire. Credit consumption must use the earliest-expiring active gift batches before permanent credits.

**Why:** The user confirmed that free and trial access should not include AI credits, but trialing customers need an explicit early-payment option when they are ready to launch. Only plan-gifted credits expire; purchased credits must retain their paid value indefinitely. Keeping monthly gifts as separate batches is required to apply the one-year expiry correctly.

**How to apply:** AI entry points must prompt zero-balance users to buy points. Future grant, debit, refund, balance, trial, or reporting work must preserve batch identity, grant only on positive paid subscription invoices, never treat subscription status alone as payment proof, prevent repeated trials, and refund exact reserved batches.