---
name: Bunny media boundaries
description: Provider security, upload cost limitations, and compatibility decisions for shared-platform Bunny media.
---

Keep platform-owned Bunny media tenant-isolated and retain Vimeo as an independent supported source. Migration of older images must preserve published URLs and originals until verified.

**Why:** The user requested both providers together and member uploads into the platform's Bunny account, not a destructive Vimeo or existing-media replacement.

**How to apply:** Authorize references against the target resource owner, including when a super-admin edits another member's content. Never treat every video already in the shared Bunny library as belonging to the requesting member.

Stream upload API keys, Storage access passwords, and embed Token Security Keys are different credentials. Configuring a signing key in the app does not enable Bunny's dashboard-side embed authentication. Embed protection alone also does not protect raw CDN/HLS URLs.

**Why:** A successful authenticated Stream upload proves nothing about playback protection; an actual unsigned embed remained accessible before the provider's security setting was enabled.

**How to apply:** Verify signed versus unsigned access after provider-side setup, fail closed when playback signing is unconfigured, and keep app entitlement revalidation active. Never substitute the upload API key for the embed security key.

Check a processed video's rendered player, not just the initial iframe HTTP status, when verifying embed protection. Keep runtime playback disabled until valid signatures work and missing, invalid, and expired signatures are rejected.

**Why:** Real-provider verification produced the same playable iframe for all four signature cases even after a token key was supplied. Possessing the key was not evidence that the library-side setting had been enabled. After enforcement took effect, Bunny returned HTTP 200 with a rendered plain “403” page and no video element for rejected signatures; requiring HTTP 403 incorrectly classified those denials as failures.

**How to apply:** Wait for the synthetic test video to finish encoding. Require actual playback progress with a valid signature, and an explicit denial page with no player for missing, invalid, and expired signatures, then delete the test asset. Unprocessed videos can return a generic HTTP 200 page before these checks, so an empty-video precheck is inconclusive. Enabling library-wide authentication can break pre-existing unsigned embeds on other sites; explain that impact before asking the user to enable it.

Bunny TUS signatures do not bind the declared upload length. Application admission reservations and later provider-size reconciliation are not hard pre-upload spending limits.

**Why:** A holder of an otherwise valid direct-upload signature can change Upload-Length outside the browser UI. Transcoded storage bytes also differ from original upload bytes.

**How to apply:** Reconcile actual reported storage, retain reservations for uncertain remote cleanup, and describe admission limits honestly. Strict pre-transfer byte limits require provider enforcement or a controlled upload gateway.

Consult the current official documentation index before implementing provider protocol details.

**Why:** Legacy Bunny documentation paths returned 404, and an unverified research summary supplied incorrect TUS header names, signing order, and player SDK details.

**How to apply:** Resolve pages through https://bunny.net/docs/llms.txt and check actual source text. Normalize callback-based Player.js methods rather than assuming Vimeo's Promise API or volume scale.

Media deletion and reference writes must remain serialized through the actual asynchronous mutation, not merely the HTTP response lifetime. Coordination must not consume the application query pool while waiting.

**Why:** Closing a browser request does not cancel its handler; releasing on response close can expose unfinished deletion to a new reference writer. Advisory-lock waiters sharing the main pool can also prevent the current lock holder from obtaining a query connection. Custom database triggers alone are not a portable guarantee through schema-only publishing.

**How to apply:** Preserve handler-completion semantics and independent coordination when optimizing locking. Any finer-grained replacement must still cover both webinar-linked and standalone product pages, draft and published snapshots, and both media deletion entry points.