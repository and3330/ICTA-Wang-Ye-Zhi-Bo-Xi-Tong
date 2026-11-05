# Threat Model

## Project Overview

開賣啦 SellCase (formerly ICTA-WEBINAR / LiveCast) is a multi-tenant SaaS "simulated live" webinar platform. Hosts use pre-recorded video (Vimeo or Bunny Stream) to create a live-webinar experience with scheduled chat, CTAs, polls, tips, Q&A, and analytics. Each registered user manages their own isolated webinars (tenant = user).

- **Stack:** Express.js + TypeScript backend, React/TypeScript frontend (Wouter, TanStack Query, shadcn/ui), PostgreSQL via Drizzle ORM, WebSocket (ws).
- **Auth:** Session-based (`req.session.userId`), bcrypt password hashing. Clerk proxy/bridge present. Super-admin via `isSuperAdmin`; member management roles via `memberAdminMetadata`.
- **Payments:** Stripe (subscriptions + recharge) and ECPay (Taiwan). AI credits, subscription credit grants, no-card trials, product/course marketplace, member orders.
- **Integrations:** Anthropic + BytePlus (ARK) for AI generation, Bunny Stream/Storage for media, Gmail (Replit connector) for mail, MCP server with OAuth provider.
- **Deployment:** Replit reserved_vm (gce), PUBLIC visibility, primary domain https://icta-webinar.com. NODE_ENV=production assumed; TLS handled by platform.

## Assets

- **User accounts & sessions** — emails, bcrypt password hashes, session cookies, password-reset/verify tokens. Compromise enables impersonation and tenant takeover.
- **Tenant webinar data** — webinar configuration, video sources (Vimeo URL / Bunny asset id), AI settings, registration lists (viewer PII: name/email/UTM), analytics, chat.
- **Host PII & config** — notification email, custom email templates/subjects.
- **Payment & billing state** — Stripe/ECPay customer/order records, subscription plan/entitlement, AI credit balances, trial eligibility.
- **Application secrets** — Stripe secret key, ECPay HMAC keys, Bunny API keys, Anthropic/BytePlus keys, SESSION_SECRET, webhook signing secrets, MCP OAuth keys.
- **Watch tokens / live CTA keys** — signed tokens gating viewer video access.

## Trust Boundaries

- **Browser ↔ API** — all client requests are untrusted; server must authenticate and authorize each request.
- **API ↔ PostgreSQL** — Drizzle parameterized queries; SQL injection would grant full DB access.
- **API ↔ External services** — Stripe, ECPay, Bunny, Anthropic, BytePlus, Gmail. Webhook/callback inbound boundaries must verify signatures (Stripe raw-body signature, ECPay CheckMacValue, outbound webhook HMAC-SHA256).
- **Public ↔ Authenticated** — public: registration, published webinar view, embed, external-journey redirects. Authenticated: dashboard, webinar CRUD, child-resource management, exports, billing.
- **User ↔ Super-admin / member-management** — `/super-admin` and admin-management routes gated by `requireSuperAdmin` / management-role checks.
- **Tenant ↔ Tenant** — webinars and child resources must be scoped to the owning user via `requireWebinarOwner` and URL-webinar-scoped storage mutations.

## Scan Anchors

- **Auth helpers (server/routes.ts):** `requireAdmin` (authenticated only, NOT object-scoped), `requireSuperAdmin`, `requireWebinarOwner` (owner/super-admin, passthrough when no `:id`), `requirePublishedOrOwner`.
- **Public serializer:** `publicWebinar()` (server/routes.ts ~300) strips only `vimeoUrl`, `videoAssetId`, `aiSettings` — allowlist, not denylist. Used by unauthenticated webinar list/detail/landing routes.
- **Highest-risk code:** server/routes.ts (5461 lines, main surface), server/storage.ts, payment modules (stripeClient, webhookHandlers, ecpay, offerPayments, memberOrders, subscriptionCreditGrants, trialCommerce, productCommerce), server/externalJourneys.ts (URL validation / redirect), server/bunnyMedia*, server/mcp/*.
- **Child-resource scoping** enforced in storage layer with URL webinar scope (see server/childResourceScope.integration.test.ts).
- **Dev-only / ignore unless proven:** test files (*.test.ts, *.integration.test.ts), e2e/, scripts/, seed-stripe-products.ts.

## Threat Categories

### Spoofing
Session-based identity; `SESSION_SECRET` is required with no fallback, cookies are HttpOnly/SameSite=Lax/secure-behind-trusted-proxy, sessions regenerate on login and Clerk bridge. Inbound webhooks verify signatures (Stripe raw signature, ECPay CheckMacValue). Guarantee: every state-changing or private-data endpoint must establish a trusted subject server-side; webhook/callback events must be signature-verified before trust.

### Tampering
Checkout/billing must derive price/plan/entitlement server-side from the catalog, never trust client-supplied amounts; credit grants must be idempotent and lock-protected. Guarantee: all pricing and entitlement decisions are server-authoritative and replay-safe.

### Information Disclosure
Public webinar responses must apply a strict allowlist of public fields. **Known issue (MEDIUM):** `publicWebinar` leaks `notifySettings.notifyEmail` and `emailSettings` to unauthenticated viewers (see `.local/new_vulnerabilities/information-disclosure/`). Guarantee: unauthenticated responses expose only fields required for rendering; host PII and internal config must be withheld.

### Elevation of Privilege
Object-level authorization must accompany authentication: `requireAdmin` alone does not scope to a tenant object, so handlers reading/writing by raw id must additionally verify ownership (observed to be done via `requireWebinarOwner` and URL-scoped storage mutations). Guarantee: server-side authorization for every sensitive object/action; no mass-assignment of `role`/`isSuperAdmin`/`userId`/`plan`/`credits`.

### SSRF / Open Redirect
User-controlled URLs (external journeys, webhook targets) are validated against private ranges. **Known issue (MEDIUM):** `isUnsafeHost` in externalJourneys.ts does not reject IPv4-mapped IPv6 addresses, permitting a client-side private-network redirect (see `.local/new_vulnerabilities/ssrf/`). Guarantee: URL validation must normalize and block all private/loopback/link-local/metadata ranges including IPv4-mapped IPv6.
