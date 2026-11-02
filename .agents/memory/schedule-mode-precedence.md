---
name: Hybrid webinar scheduling
description: How on-demand viewing coexists with recurring and scheduled registration choices.
---

# Hybrid schedule resolution

On-demand viewing is an additive registration choice, not an exclusive schedule
mode. When enabled, viewers must be able to choose either "隨到隨看" or one of
the webinar's available recurring/persisted sessions.

**Why:** Owners use on-demand to add immediate access without removing scheduled
attendance. Treating it as exclusive made all existing session choices disappear.

**How to apply:** Preserve recurring configuration and scheduled sessions, return
on-demand availability alongside them, and let registration UIs add a non-date
"隨到隨看" choice. Only real session timestamps should be stored as a selected
session.

JIT is also additive: expose its signed immediate-start slot alongside future
managed/recurring sessions, not instead of them.

**Why:** The user requires session management and future reservations to remain
usable while both on-demand and JIT are enabled.

**How to apply:** Keep JIT signature verification for dynamic slots; validate
future reservations against exact eligible session timestamps. Never force a
future reservation through JIT-token validation.

# Registration-bound watch access

Published webinar metadata is public for registration, but playable media is not.
Anonymous viewers need a signed, registration-scoped credential to obtain the media
URL or join the viewer WebSocket; the only tokenless exception is an authenticated
owner preview. Scheduled credentials must remain valid through the selected session
and replay window, and every confirmation, reminder, and sequence email must carry a
fresh tokenized watch link.

**Why:** Client-side countdowns and hidden controls are bypassable when a viewer can
remove a query parameter, join the socket without a credential, or read the raw
Vimeo URL from a public API. Bare reminder links also lock out legitimate registrants
once tokenless access is closed.

**How to apply:** Enforce selected-session timing at the server watch-state and
WebSocket boundaries, redact playable URLs from anonymous webinar responses, scope
tokens to both registration and webinar, and derive expiry from session/replay timing.
Treat "no future sessions and no on-demand" as closed registration, never as on-demand.

# Admin UX
Schedule sub-section saves only flash a toast. Owners need persistent state, so the
schedule card shows a current-mode banner + per-mode "使用中" active indicators, and
session-management explains that future reservations can coexist with on-demand/JIT.
