---
name: AI point billing invariants
description: Concurrency/consistency rules for the per-tenant AI point billing & Stripe recharge flow
---

# AI point billing (per-tenant 廠商 AI 點數)

AI replies deduct points from the **webinar owner** (webinar.userId), not the viewer. Super admin / enterprise plan = unlimited (skip all point logic).

## Exception: premium sales-script generation is always metered
The sales-script add-on requires real AI credit lots even for enterprise/admin accounts; free trial calls cannot pay for it. Trial members with sufficient purchased credits may use it. Only the webinar owner may authorize this charge, not an administrator browsing another owner's webinar.
**Why:** The user explicitly made this a separately paid add-on to prevent free use; ordinary unlimited AI privileges must not waive its fee or authorize spending another member's balance.
**How to apply:** Keep add-on admission separate from ordinary unlimited/trial AI paths. Reveal the finished script only after its output and credit consumption commit together; partial checkpoints must not become free content after a refund.

The unpaid sales-script experience should explain deliverables and collect ordinary business facts, not teach or preview the proprietary framework.
**Why:** The user wants members to purchase the service rather than reconstruct the method from the free interface. A purchase-intent click is not authorization to charge before the final generation confirmation.
**How to apply:** Keep order previews non-generative, do not expose method names or reusable instructional samples before payment, and preserve explicit final fee confirmation during UI redesigns.

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
