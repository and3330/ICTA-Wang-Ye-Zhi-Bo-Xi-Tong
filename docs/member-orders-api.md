# Member order-management API

Stable base path: `/api/member/orders`.

This is a signed-in **member seller** API. Every route requires an active
session and is scoped to `session.userId`; a superadmin has no cross-member
bypass. An unknown order and an order owned by someone else both return `404`.
These are product-page and webinar-offer commerce orders only. They do not
include, merge, or alter the platform's SaaS subscription invoices or receipts.

All money is an integer in the currency's minor unit (`amountMinor`); clients
must not convert it to floating point. All timestamps returned are ISO-8601
instants.

## Public checkout buyer input

New standalone product checkout requests must include this exact additional
body member:

```json
{ "buyer": { "name": "Ada Example", "email": "ada@example.com" } }
```

`buyer.name` is trimmed, 1–200 characters; `buyer.email` is a normalized valid
email, maximum 320 characters. The server records both immutable snapshots
before redirecting to ECPay. For a registered webinar checkout, the server
uses the verified registration's name and email instead of accepting a client
cross-registration identity. That request must send the existing signed
`watchToken` in the body (or `X-Watch-Token`/Bearer header) alongside
`registrationId`; the token must cryptographically bind that registration to
the requested webinar. An unregistered checkout allowed by its webinar uses
the same required `buyer` object.

## Read endpoints

### `GET /api/member/orders`

Lists the member's orders, newest `createdAt` first, with `id` descending as a
stable tie-breaker.

Query:

| name | type | limit / meaning |
| --- | --- | --- |
| `page` | integer | 1–10000, default 1 |
| `pageSize` | integer | 1–100, default 25 |
| `q` | string | 1–200 chars; case-insensitive search of order id, safe provider reference, immutable buyer snapshot, and product snapshot |
| `productId` | UUID | owned product |
| `paymentStatus` | enum | `pending`, `paid`, `failed`, `partially_refunded`, `refunded` |
| `fulfillmentStatus` | enum | `pending`, `in_progress`, `completed`, `cancelled` |
| `currency` | ISO currency | three letters |
| `from`, `to` | ISO instant | inclusive boundaries; must include an offset, for example `2025-01-01T00:00:00+08:00` |

`from`/`to` are compared to order creation time. Date-only values and an
implicit member/browser timezone are deliberately unsupported. Invalid,
unknown, duplicate, or out-of-range query values return `400`.

Response is `MemberOrderListResponse` from `shared/memberOrders.ts`. Empty
results are `200` with `items: []` and `total: 0`.

### `GET /api/member/orders/product-filters`

Returns owned product filter options only:

```json
{
  "items": [{ "id": "uuid", "name": "Product title", "nameSource": "legacy_live" }],
  "truncated": false
}
```

It is bounded to 500 products, sorted by product name then id. `truncated:
true` explicitly tells the UI that further owned products are not represented
by this bounded filter endpoint. `nameSource`
signals whether the label is an immutable recorded name, a live legacy display
fallback, or unavailable historical data.

### `GET /api/member/orders/summary`

Uses the same filter names and semantics as the list endpoint (excluding
`page`/`pageSize`) and computes over the full matching dataset, not the
visible page.

```json
{
  "currencies": [{
    "currency": "TWD",
    "counts": { "pending": 2, "paid": 8, "failed": 1, "partially_refunded": 1, "refunded": 1 },
    "paidGrossMinor": 80000,
    "refundedMinor": 15000,
    "netMinor": 65000
  }]
}
```

There is one item per currency. `paidGrossMinor` includes the original amount
for paid, partially-refunded, and fully refunded orders; `refundedMinor`
includes the bounded authoritative refund amount for those same orders;
`netMinor` is gross minus refunded. A fully refunded 100-minor-unit order
therefore contributes 100 gross, 100 refunded, and 0 net. Refund amounts are
clamped to `[0, amountMinor]`.
Pending and failed rows never count as revenue.

### `GET /api/member/orders/export.csv`

Uses the same filters as summary/list and returns UTF-8 CSV with a header.
The maximum export is 10,000 data rows. Results are deterministic
(`createdAt DESC, id DESC`), formula-safe (cells beginning with `=`, `+`, `-`,
or `@` are prefixed with a single quote), and limited to safe seller-facing
fields. No credential, checkout status token, raw provider callback, or
untrusted provider payload is exported.

If more than 10,000 rows match, the API exports the first 10,000 and returns:

```
X-Export-Truncated: true
X-Export-Row-Count: 10000
```

Otherwise it returns `X-Export-Truncated: false`. CSV never silently claims a
truncated result is complete.

### `GET /api/member/orders/:id`

Returns `MemberOrderDetail`: immutable buyer/product snapshots, safe receipt
reference/status, attribution IDs, internal note, current version, and an
append-only timeline. Provider credentials, raw event payloads, payment status
tokens, and public-buyer data are never exposed.

Historical rows may have `null` buyer or product snapshot fields. `recorded`
means data was captured at checkout. `legacy_live` explicitly labels a
presentational current-product fallback; `legacy_missing` means no historical
snapshot exists. A fallback is never represented as an immutable historical
record.

ECPay refund information is marked `external_merchant_status_unknown` because
refunds are merchant-managed and provider information can be stale.

## Update endpoint

### `PATCH /api/member/orders/:id`

Only `internalNote` and `fulfillmentStatus` may change:

```json
{
  "expectedVersion": 4,
  "reason": "Customer confirmed delivery address",
  "internalNote": "Packed in shipment 17",
  "fulfillmentStatus": "in_progress"
}
```

`reason` is required (1–500 trimmed characters) for every update.
`expectedVersion` is required. A stale version returns `409` with
`code: "VERSION_CONFLICT"` and does not write an event. Unknown fields,
including any payment amount, currency, payment status, provider reference,
buyer/product snapshot, or attribution field, return `400`.

Valid fulfillment values: `pending`, `in_progress`, `completed`, `cancelled`.
`completed` requires a paid order with positive net amount; a fully refunded
order cannot be completed. `cancelled` only stops fulfillment; it does not
cancel a payment or issue a refund. Every actual update appends an immutable
operator event and increments `version`. There is no endpoint to manually
alter payment or monetary state.

## Payment truth

The browser ECPay return route is informational only and never marks an order
paid. Only authenticated provider callbacks can update payment truth.
Authoritative late success can recover a prior failed/pending payment; a later
failure can never downgrade a paid payment. Ambiguous or asynchronous
non-success ECPay statuses remain `pending` with provider-status evidence and
an awaiting-confirmation message. Callback replay/reordering is idempotent.