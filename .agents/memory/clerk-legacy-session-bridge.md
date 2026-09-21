---
name: Clerk legacy-session bridge
description: Identity-linking and logout rules while Clerk Google OAuth coexists with SellCase's local member/session model.
---

Treat the Clerk-to-local-member link as immutable. Link only from a server-fetched, verified primary email; never replace a different non-null Clerk identity, and keep suspended accounts fail-closed. OAuth completion may establish the existing Express session only after this bridge succeeds.

**Why:** Existing ownership, billing, trials, and management authorization are keyed to the local member ID. Rebinding a verified email to another Clerk identity would permit account takeover.

**How to apply:** Any new Clerk provider or callback must reuse the same bridge rules. Logout must terminate both the Clerk browser session and the legacy Express session; clearing only one permits silent session restoration.