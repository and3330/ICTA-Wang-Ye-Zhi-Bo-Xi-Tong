# Management API

Base path: `/api/management`; every endpoint requires the existing server session. Errors are `{ "message": "…" }`; identifiers are UUIDs except provider order references, timestamps ISO-8601, and all money is integer minor units. Do not render an action unless `GET /me` includes its permission. The server still authorizes each request.

## Read

| Method/path | Permission | Request | Response |
|---|---|---|---|
| `GET /me` | management access | — | `ManagementMeDto` |
| `GET /overview` | `members.read` | — | `ManagementOverviewDto` |
| `GET /catalog` | management access | — | `ManagementCatalogDto` |
| `GET /members` | `members.read` | `page=1..1000000&pageSize=1..100&search<=200&role&active&plan` | `PaginatedDto<MemberListItemDto>` |
| `GET /members/:userId` | `members.read` | — | `MemberDetailDto` |
| `GET /subscriptions` | `subscriptions.read` | `page=1..1000000&pageSize=1..100&search<=200&userId&status` | `PaginatedDto<SubscriptionDto>` |
| `GET /members/:userId/ai-ledger` | `credits.read` | `page&pageSize` | `PaginatedDto<AiLedgerEntryDto>` |
| `GET /orders` | `billing.read` | `kind=member_order` (default), `platform_invoice`, or `ai_purchase`; plus `page&pageSize&userId&provider&status&from&to` | `PaginatedDto<OrderDto>` |
| `GET /support` | `support.read` | `page&pageSize&search<=200&userId&status` | `PaginatedDto<SupportCaseDto>` |
| `GET /audit` | `audit.read` | `page&pageSize&targetUserId&action` | `PaginatedDto<AuditEventDto>` |
| `GET /audit/export.csv` | `audit.export` | audit query (max 10,000 rows) | formula-safe CSV attachment |

## Mutations

All mutation bodies are strict JSON; `reason` is required (1–1000 chars) whenever the operation changes another member or billing state.

| Method/path | Permission | Body | Result |
|---|---|---|---|
| `PATCH /members/:userId/profile` | `members.write` | `{username?,email?,companyName?,reason}`; profile fields are bounded strings | `MemberProfileDto` |
| `PATCH /members/:userId/role` | `members.roles` | `{role,reason}` | `MemberProfileDto` |
| `POST /members/:userId/disable` | `members.disable` | `{reason}` | `MemberProfileDto` |
| `POST /members/:userId/enable` | `members.disable` | `{reason}` | `MemberProfileDto` |
| `POST /members/:userId/revoke-sessions` | `members.disable` | `{reason}` | `{revoked:true}` |
| `POST /members/:userId/password-reset` | `members.write` | `{reason}` | `{requested:true}`; invokes the existing safe reset-token flow and never returns a token |
| `PUT /members/:userId/notes` | `members.write` | `{notes:string[],tags:string[],reason}` | `MemberProfileDto` |
| `POST /members/:userId/overrides` | `subscriptions.write` | `{publishingSlots:1..999,expiresAt,reason}` (expiry 1 minute–366 days) | `EntitlementOverrideDto`; `publishingSlots` is temporary **absolute total capacity**, and cannot reduce a higher paid/grandfathered quota |
| `DELETE /members/:userId/overrides/:overrideId` | `subscriptions.write` | `{reason}` | `{removed:true}` |
| `POST /subscriptions/:userId/cancel-at-period-end` | `subscriptions.write` | `{reason}` | `SubscriptionDto`; Stripe is updated through the existing server client |
| `POST /subscriptions/:userId/resume` | `subscriptions.write` | `{reason}` | `SubscriptionDto`; rejects unavailable/no subscription |
| `POST /members/:userId/ai-grants` | `credits.grant` | `{points:1..100000,expiresAt?,reason,idempotencyKey}` | `{added,points}` |
| `POST /orders/:orderId/refunds` | `billing.refund` | `{amountMinor,reason,idempotencyKey}` | `{requested,providerReference,idempotent?,pending?}`. A key is durably bound to its order and amount: completed calls replay the same provider reference, in-flight calls return explicit `pending:true`, and a changed payload returns `409`. Stripe validates immutable order attribution (member orders) or verified invoice payment ownership before requesting a refund; webhook reconciliation remains authoritative. ECPay returns `409` with its external-merchant limitation and records an audit note. AI point purchases explicitly return `409` because this console has no independent supported AI-purchase refund path. |
| `PATCH /support/:id` | `support.write` | `{status?,adminNote?,reason}`; at least one editable field | `SupportCaseDto` |

`GET /members` and `GET /members/:userId` omit subscription summary fields without `subscriptions.read` and `aiPoints` without `credits.read`. `GET /members/:userId` additionally omits `usage` unless `credits.read`, `override` unless `subscriptions.read`, `subscription` unless `subscriptions.read`, and `products` unless `billing.read`; this prevents support access from bypassing financial/credit scopes. `PaginatedDto.availability` is always present for order/subscription collections. Orders are never offset-merged across sources: use the explicit `kind` tab (the default is `member_order`); `provider=ecpay` never invokes or returns Stripe platform invoices. Live Stripe collections report `total:null` and `hasMore` because Stripe cursor pagination has no honest offset total; local-only member order totals remain numeric. Stripe provider errors, absent connector, and account/environment mismatches are explicitly reported there and never shown as a successful empty provider result. `OrderDto.providerMode` and `providerAccountLabel` describe only a safe provider environment/account class, never an identifier or credential. `SubscriptionDto` and `OrderDto` use provider-authenticated amounts, interval and receipt/invoice URLs when Stripe is available. Platform invoices/AI purchases and member ECPay/Stripe orders stay distinct in `OrderDto.kind`. A non-root staff member may edit company/notes for staff accounts, but may not alter their login identity or request their password reset. Protected-root, self-demotion/self-disable, and removal of the final active super-admin return `403`. `member` cannot access this API.