# No-card 14-day trial

The no-card trial is separate from Stripe subscriptions and AI credit lots. A
new account starts one immutable 14-day entitlement; an eligible existing free
account may explicitly activate it once. Stripe history, paid access, a manual
plan, or any retained no-card trial row makes an account ineligible.

Each actual AI provider request reserves one row in the no-card trial ledger.
Only reserved and completed rows count toward the shared 50-call cap. Provider
or persistence failures refund the reservation. The ledger is retained for at
least 30 days after expiry (and is never automatically deleted), and it never
changes `users.ai_points` or paid AI-credit lots.

While active, trial expiry is checked at every entitlement and AI admission
point. Upgrading uses the existing paid entitlement/published snapshots and
does not reset either the no-card trial or its AI-call ledger.

`GET /api/trial` returns `state: "upgraded"` (while retaining the original
clock and ledger) when an active paid or manual entitlement takes precedence.
Clients must not treat that state as a 50-call trial cap or block paid AI.