# External journeys and external sales attribution API

安全報名交接的完整繁體中文接入文件（成功／失敗 JSON、欄位型別、
一次性兌換與恢復限制、相對觀看連結、iframe 跳轉及測試清單）：
[SellCase 安全報名交接串接指南](registration-handoff-api.md)。

All money is an integer **minor unit**. This integration is intentionally
separate from provider-verified platform orders: browser reports are
unverified and merchant HMAC reports are `merchant_reported`, not
provider-verified revenue.

## Owner configuration

`GET|PUT /api/webinars/:id/external-journey` returns/saves a draft. `PUT`
requires `{version,settings}` and optimistic-locks. `POST
/api/webinars/:id/external-journey/publish` requires `{version}` and is the
only operation that changes public behavior. Public reads use the immutable
published snapshot: `GET /api/webinars/:id/external-journey/public`.

`settings` is defined by `shared/externalJourneys.ts`. Origins are exact HTTPS
origins; URLs are credential-free HTTPS URLs. The server additionally rejects
localhost, private/reserved addresses (including IPv4-mapped IPv6 literals and A/AAAA DNS resolution), and
internal platform journey routes. DNS validation is bounded and an
unresolvable host is rejected rather than silently accepted.
`/form/:id` and `/embed/register/:id` always remain built-in registration
paths; `/webinar/:id` is never a marketing redirect.
Customer HTTPS paths such as `https://customer.example/register` are valid;
loop paths are rejected only when their host is this platform. Existing
external registration **and webinar** embeds must be added as exact values in
`approvedEmbedOrigins`; this replaces the unsafe historical wildcard while
preserving same-origin embeds.
`/register/:id?preview=1` also bypasses marketing redirect so the existing
owner preview UI can load; its subsequent draft-preview API remains
authenticated and no draft is available through a public API.
Built-in `/register` → `/form` redirects preserve their original query for
legacy UTM/session-prefill compatibility. External landing redirects propagate
only bounded `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, and
`utm_content`; they never forward watch tokens, handoffs, names, emails, or
arbitrary inbound redirect parameters.

## Installation and handoff

`POST /api/member/external-journeys/connection/rotate` returns a newly rotated
integration secret once. It is stored encrypted and never returned again.
`GET /api/member/external-journeys/connection` returns status and relative
installation endpoint paths only.

After a successfully persisted registration, an external thank-you response
can include `externalThankYou.redirectUrl`. It contains only an opaque,
short-lived one-use handoff. Exchange it server-to-server with
`POST /api/external/handoffs/exchange`, header `Authorization: Bearer <secret>`
and `{handoff}`. The exchange returns registration ID, webinar ID, selected
session, and only returns `watchUrl` when the published setting explicitly
allows it. `includeContactInHandoff` defaults to false; when explicitly
published, authenticated exchange additionally returns only `{name,email}`.
This contact is never placed in a URL, public response, event log, or browser
snippet. The server exchange must send `X-External-Destination` containing
its configured HTTPS origin (or a matching browser `Origin`). Names, email
addresses, and raw watch tokens never appear in an
external URL.

The handoff expires 600 seconds after creation and is consumed once. The
standard registration flow stores a **relative** `watchUrl`; resolve it against
the trusted SellCase service origin, never the partner website's origin.
The response has no webinar title, timezone, delivery status, or separate mode.
There is no idempotent retrieval after consumption, including a lost response.
Embedded registration navigates its own frame and returns before emitting
`livecast:registered` on the external-redirect branch.

When the published external thank-you URL's exact origin is also listed in
`approvedOrigins`, registration success automatically appends an opaque
`sc_ref` to that configured destination and persists a
`registration_success` referral with verified registration/session provenance.
No browser referral-create call is needed. If the origin is not approved, the
destination remains a plain redirect (an explicit attribution opt-out); the
persisted target is always the configured thank-you URL, never a URL
containing handoff/query capabilities.

## Attribution and sales reports

Create a tracked CTA redirect with `POST
/api/webinars/:id/external-referrals` using `{targetKind:"cta",ctaId,targetUrl,
visitId?,sessionId?}`. Use `{targetKind:"thank_you",targetUrl,...}` only for
the published external thank-you destination. A `sessionId` is verified to
belong to the webinar but does not claim attendance. A registered caller can
instead send its bearer watch token in `X-Watch-Token`; the server verifies it
and records the registration's selected session without trusting any browser
registration ID. The server verifies the published webinar, exact persisted
CTA/configured thank-you target and external safe target. It returns an opaque `scRef`, `visitId`, and relative
`redirectUrl`. `GET /r/:scRef` adds the signed opaque `sc_ref` without
discarding existing query parameters or fragments.

`POST /api/external/reported` accepts browser reports
`{scRef,orderId,amountMinor,currency}`. It has exact approved-origin CORS,
rate/size limits, and is always stored as unverified `browser_reported`.
For a cross-origin JSON preflight, call the same endpoint with
`?scRef=<opaque>`; the opaque referral lets the server select the exact
published allowlist without accepting a caller-supplied webinar ID.

Merchant events use `POST /api/external/merchant-events/:webinarId`, exact raw
body HMAC SHA-256 in `X-External-Signature`, Unix seconds
`X-External-Timestamp` (five minute skew), and the per-member integration
secret. The signature input is exactly the UTF-8 bytes
`<timestamp>.<rawBody>`; do not parse/re-stringify the JSON before signing.
Body is `{eventId,orderId,type:"purchase"|"refund",amountMinor,
currency,scRef?,occurredAt?}`. Event IDs replay identically; a changed payload
is rejected. `refund.amountMinor` is the **cumulative refunded amount for that
order**, not a delta: a `purchase 1000`, `refund 300`, `refund 1000` sequence
has gross 1000, refund 1000, net 0. Re-sending the same cumulative value or
receiving a refund before the purchase is harmless; each order is serialized
and net is never negative.

Browser and merchant event ID namespaces are separate. An unverified browser
report cannot reserve an order ID, currency, webinar, or merchant idempotency
key: a later valid merchant purchase supersedes the provisional aggregate while
the browser receipt remains labelled separately. Conflicting authenticated
merchant currencies for one owner/order are rejected as an integrity error.

## External order console

`GET /api/member/external-orders`, `/summary`, `/export.csv`, and
`/:id` are ownership-scoped, independently paginated read-only views. Filters:
`q`, `sourceTrust`, `currency`, `from`, `to`, `page`, `pageSize`.
Totals are labelled merchant-reported/unverified and must never be combined
with confirmed platform/provider revenue.

## Stable response shapes

Owner draft read returns `{version,settings,publishedAt}`; save and publish
return the persisted settings row (`settings`, `publishedSettings`, `version`,
timestamps). Connection status is `{connected,version,rotatedAt,
merchantEventsPath,handoffExchangePath}`. Rotate returns `{secret,warning}`
once only. No status or troubleshooting response contains a secret.
`GET /api/member/external-journeys/events` supplies the latest 100 safe
receipts (`eventId`, order/webinar IDs, amount, currency, trust, timestamps)
for installation troubleshooting. It deliberately excludes signatures,
payloads, headers, fingerprints, PII, and keys.

External order list returns `{items,page,pageSize,total,labelled}`, where each
item has `id,orderId,webinarId,sessionId,selectedSession,sourceTrust,currency,
purchaseObserved,grossPaidMinor,refundedMinor,netMinor,createdAt,updatedAt`.
`grossPaidMinor` and `netMinor` are `null` while a refund is received before
any purchase, rather than a misleading zero-value sale. Summary returns
`{labelled,currencies:[{currency,sourceTrust,grossPaidMinor,refundedMinor,
netMinor,count,pendingCount}]}`; unresolved refund-first rows are excluded
from paid totals and counted in `pendingCount`. Detail adds safe event receipts only:
`{id,eventId,eventType,sourceTrust,amountMinor,currency,occurredAt}`. There
are no raw merchant payloads, browser PII, secrets, or fulfillment actions.

For example a published external journey response is:
`{"landingMode":"external","landingUrl":"https://example.com/join",
"thankYouMode":"external","approvedOrigins":["https://example.com"],
"approvedEmbedOrigins":["https://example.com"]}`. A referral create response
is `{"scRef":"opaque","visitId":"opaque","redirectUrl":"/r/opaque",
"referralId":"uuid"}`. Browser reporting response is
`{"accepted":true,"unverified":true,"replayed":false}`; merchant reporting is
`{"accepted":true,"sourceTrust":"merchant_reported","replayed":false}`.