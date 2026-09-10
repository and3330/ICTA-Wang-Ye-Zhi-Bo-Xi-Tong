---
name: AI point billing invariants
description: Concurrency/consistency rules for the per-tenant AI point billing & Stripe recharge flow
---

# AI point billing (per-tenant 廠商 AI 點數)

AI replies deduct points from the **webinar owner** (webinar.userId), not the viewer. Super admin / enterprise plan = unlimited (skip all point logic).

## Rule: reserve points BEFORE calling the LLM, refund on failure
Deduct 1 point atomically first; only then call Anthropic. If the LLM call fails, add the point back.
**Why:** the old order (call LLM → then deduct) let "only 1 point left + concurrent questions" fire multiple paid Anthropic calls before any deduction landed — wasted spend. A pre-check is not enough under concurrency; you must actually reserve atomically.
**How to apply:** any metered/paid external call gated by a balance must reserve-then-refund, never check-then-charge-after.

## Rule: crediting a paid recharge must be ONE db transaction
Insert the idempotency row (unique stripe_session_id, `onConflictDoNothing`) AND increment the balance inside a single `db.transaction`. Empty insert result ⇒ already processed ⇒ do not re-credit.
**Why:** doing insert then a separate balance update risks "paid but never credited" — if the process crashes between the two, the idempotency row blocks every retry while points were never added.
**How to apply:** never split "record idempotency marker" and "apply the effect" across separate awaited statements for money flows.

## Rule: verify session ownership before the idempotency shortcut
On confirm-recharge, look up the existing transaction's userId and 403 if it isn't the caller, before returning "alreadyProcessed".
**Why:** returning success on any already-processed session (without owner check) leaks whether an arbitrary Stripe session id has been processed (session probing).
