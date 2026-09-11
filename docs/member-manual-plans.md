# Member manual plans

Manual plans are an audited, temporary **non-payment** entitlement for a member.
They never write `users.subscription_plan`, `subscription_status`, Stripe customer
or subscription identifiers, invoices, trials, or AI credit lots. The member's
paid billing data therefore remains Stripe-derived and is returned separately.

## Plan options and time rules

The accepted plan IDs are the existing catalog IDs: `starter` (Starter), `growth`
(Growth), and `scale` (Scale). There is no `business` catalog ID in this service.
`startsAt` and `expiresAt` are ISO-8601 instants, so hour and day precision are
preserved. A grant must end after it starts, may start up to 366 days ahead, and
may end at most five years from the request time. `extendHours` is an integer
from 1 through 43,800 (five years) and extends the stored expiry.

While active, a manual plan supplies the selected plan's normal non-AI capacity:
published-webinar capacity and monthly registration capacity. It is composed
with the paid entitlement using the larger capacity, so it cannot reduce paid
rights. It provides no AI points. Future grants are pending; expired and revoked
grants grant nothing. Public HTTP, websocket-adjacent admission checks, media,
and sales-page checks read this state at admission time.

## Management API

All endpoints require `subscriptions.write`, target protection (non-root actors
cannot alter protected roots), a non-empty `reason`, and an idempotency key of
8–100 `[A-Za-z0-9_.:-]` characters. Idempotency keys are scoped to the member
and operation. Mutation responses return a `MemberManualPlanDto`.

* `GET /api/management/members/:userId` includes `manualPlan` and
  `effectivePlan` only when the caller has `subscriptions.read`; it also retains
  `subscription`, which is paid billing data only.
* `POST /api/management/members/:userId/manual-plan`
  body: `CreateMemberManualPlanBody`; response `201` (or `200` for an identical
  idempotent replay).
* `PATCH /api/management/members/:userId/manual-plan`
  body: `UpdateMemberManualPlanBody`. Supply schedule/tier fields, or
  `extendHours`; it requires the current optimistic `version`.
* `DELETE /api/management/members/:userId/manual-plan`
  body: `RevokeMemberManualPlanBody`; it requires the current `version`.

There is one retained manual-plan row per member. Mutations lock that row and
increment `version`; conflicting stale versions return `409`. A revocation is a
state transition, not a delete. Every creation, update, extension, and
revocation appends an `admin_audit_events` record with its required reason.

### Stable client payloads

Use these exact lower-camel-case keys. A create has no default times: the client
must explicitly send both instants. Update fields other than `reason`, `version`,
and `idempotencyKey` are optional; omitted schedule/tier fields retain their
current values. `extendHours` and `expiresAt` are mutually exclusive.

```json
POST /api/management/members/:userId/manual-plan
{
  "plan": "growth",
  "startsAt": "2026-09-01T09:00:00.000Z",
  "expiresAt": "2026-09-08T09:00:00.000Z",
  "reason": "approved support extension",
  "idempotencyKey": "manual-growth-20260901"
}
```

```json
PATCH /api/management/members/:userId/manual-plan
{
  "extendHours": 24,
  "reason": "one additional day",
  "version": 1,
  "idempotencyKey": "manual-growth-extend-1"
}
```

Each successful mutation returns:

```json
{
  "id": "uuid", "userId": "uuid", "plan": "growth", "state": "active",
  "startsAt": "ISO-8601", "expiresAt": "ISO-8601",
  "revokedAt": null, "revokedBy": null, "reason": "approved support extension",
  "version": 1, "createdAt": "ISO-8601", "createdBy": "uuid",
  "updatedAt": "ISO-8601"
}
```

`GET /api/management/members/:userId` adds three subscription-read fields:
`manualPlan` (the same object or `null`), `effectivePlan`
(`plan`, `source`, `active`, `maxWebinars`, `monthlyRegistrants`,
`manualExpiresAt`), and `subscription`. `source` can be `override` when the
legacy capacity-only override is the strongest effective publication capacity.
`subscription` remains the actual paid Stripe/local billing timeline. The
member endpoint `GET /api/admin/subscription` returns the same
`manualPlan`/`effectivePlan` plus the currently active `publishingOverride`
(or `null`) and a `paid` object with
`plan`, `status`, `active`, `planStartedAt`, `planExpiresAt`,
`cancelAtPeriodEnd`, `amountUsd`, and `stripeSubscriptionId`. Use `paid.active`
and the paid fields—not `effectivePlan.active`—to display payment-portal,
cancel, renewal, or next-charge controls.