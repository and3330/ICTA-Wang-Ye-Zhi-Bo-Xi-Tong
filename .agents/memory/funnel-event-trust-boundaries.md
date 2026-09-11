---
name: Funnel event trust boundaries
description: Trust and identity rules that keep webinar funnel analytics credible.
---

Never accept purchase or revenue events from a public browser endpoint into verified funnel totals. Verified revenue must come from a payment-provider webhook with provider-event idempotency.

**Why:** Rate limits and client-generated dedupe keys do not establish payment authenticity; accepting browser purchase events lets anyone forge dashboard revenue.

**How to apply:** Keep purchase modeled for aggregation, but create it only through a server-side verified payment path.

External browser reports and merchant-signed reports are separate evidence categories, neither equivalent to provider-verified revenue. A merchant signature authenticates the sender, not the payment.

**Why:** Members control their external shops and signing secrets, so they can report arbitrary amounts. Browser claims must also remain provisional rather than reserving an order's currency or attribution against later merchant evidence.

**How to apply:** Keep external summaries separate from verified revenue; permit stronger evidence to supersede browser claims. Refund-first orders have unknown gross/net until a purchase arrives, not a known zero sale. Preserve authenticated late financial reports after public pages are unpublished.

Optional external redirects and handoffs must not turn a durably successful registration into a reported failure.

**Why:** A false failure encourages resubmission, which then hits duplicate-registration protection while confirmation/webhook delivery may already be in progress.

**How to apply:** Keep the successful registration and internal viewing path, show an explicit external-page warning, and never repeat the registration or its notifications merely to retry an optional integration.

An authoritative registration event must carry the hash of the same anonymous visitor token used before registration; never store the raw token with the registration.

**Why:** Without the shared hash, one person is counted as separate landing and registration identities, corrupting unique-viewer conversion rates.

**How to apply:** Accept a strictly bounded opaque token with registration, remove it from business data, and hash it inside the registration transaction.

Ephemeral live CTA identifiers must be server-issued, short-lived, HMAC-protected, and bound to the webinar.

**Why:** Accepting arbitrary CTA keys allows cross-webinar or fabricated CTA performance while UUID-only validation drops live CTAs entirely.

**How to apply:** Verify canonical encoding, signature, webinar binding, and expiry before accepting live CTA events. Persisted CTA keys remain server-generated, backfilled, non-null, and unique.

Refund webhooks must be durable before their matching payment arrives, and cumulative refund reconciliation must serialize by provider payment identity.

**Why:** Payment providers may deliver retries, concurrent partial refunds, or a refund before checkout completion. Treating delivery order as guaranteed can lose refunds or reverse revenue more than once.

**How to apply:** Persist unmatched verified refunds, lock reconciliation by payment identity, and derive one delta from the provider's maximum cumulative refunded amount rather than summing webhook payloads.