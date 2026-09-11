---
name: AI credit expiry
description: Business rules for monthly subscription gifts, purchased credits, expiry, and consumption order.
---

Free accounts start with zero AI points. New eligible customers instead receive a one-time, no-card 14-day trial with 50 shared AI calls in a separate expiring budget; these are not paid points. New checkout upgrades charge immediately, without a second Stripe trial. Preserve pre-existing Stripe trial end dates and their no-gift rules; a trialing customer may explicitly end that legacy trial early and pay immediately. Only positive paid invoices grant plan credits. Subscription plans grant AI credits after that first positive payment and after each successful monthly renewal: Starter 100, Growth 200, Scale 300. Each gifted batch expires one calendar year after it is granted. Separately purchased credits never expire. Credit consumption must use the earliest-expiring active gift batches before permanent credits.

**Why:** The trial should let new users publish a branded product page and collect real leads without supplying a card. Its limited AI allowance must not fabricate paid credits or change old subscription promises. Only plan-gifted credits expire; purchased credits must retain their paid value indefinitely.

**How to apply:** AI entry points must check active no-card call allowance before rejecting zero paid-point balances. Reserve and refund the correct budget, never both. Multi-request operations disclose their call count. Future grant, debit, refund, balance, trial, or reporting work must preserve batch identity, grant paid gifts only on positive paid subscription invoices, prevent repeated trials, and refund exact reserved batches. Paid/manual access supersedes trial UI limits without resetting its dates or allowance.