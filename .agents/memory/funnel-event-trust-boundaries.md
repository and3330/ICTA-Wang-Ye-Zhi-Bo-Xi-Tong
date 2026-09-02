---
name: Funnel event trust boundaries
description: Trust and identity rules that keep webinar funnel analytics credible.
---

Never accept purchase or revenue events from a public browser endpoint. Revenue must come from a verified payment-provider webhook with provider-event idempotency.

**Why:** Rate limits and client-generated dedupe keys do not establish payment authenticity; accepting browser purchase events lets anyone forge dashboard revenue.

**How to apply:** Keep purchase modeled for aggregation, but create it only through a server-side verified payment path.

An authoritative registration event must carry the hash of the same anonymous visitor token used before registration; never store the raw token with the registration.

**Why:** Without the shared hash, one person is counted as separate landing and registration identities, corrupting unique-viewer conversion rates.

**How to apply:** Accept a strictly bounded opaque token with registration, remove it from business data, and hash it inside the registration transaction.

Ephemeral live CTA identifiers must be server-issued, short-lived, HMAC-protected, and bound to the webinar.

**Why:** Accepting arbitrary CTA keys allows cross-webinar or fabricated CTA performance while UUID-only validation drops live CTAs entirely.

**How to apply:** Verify canonical encoding, signature, webinar binding, and expiry before accepting live CTA events. Persisted CTA keys remain server-generated, backfilled, non-null, and unique.