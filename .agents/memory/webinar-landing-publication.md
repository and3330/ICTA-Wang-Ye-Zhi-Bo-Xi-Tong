---
name: Webinar landing publication
description: Publication and compatibility rules for safe webinar registration landing pages.
---

Public webinar landing pages must read an immutable published snapshot, while the editor writes separate draft fields. Saving a draft must never mutate the live page; only an explicit version-checked publish copies draft content into the public snapshot.

**Why:** A single mutable row made post-publish draft saves immediately visible and allowed the editor to misrepresent whether changes were live. Request-time compatibility provisioning also risked publishing newly created owner drafts without consent.

**How to apply:** Require both webinar publication and a published landing snapshot in public reads and registration writes. Handle legacy compatibility only in an idempotent migration backfill, never by creating or publishing from anonymous requests.

Rich landing-page content must be stored as a tightly allowlisted JSON document tree and rendered as React nodes through one shared editor/public renderer; never persist or inject arbitrary HTML. Image uploads must be accepted by verified file signatures, given server-generated safe extensions, and served with non-executable headers.

**Why:** Editor-generated HTML and client-declared MIME types create stored-XSS paths and can make ordinary authoring output incompatible with server validation.