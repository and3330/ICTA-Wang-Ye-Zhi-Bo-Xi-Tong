---
name: Webinar schedule mode precedence
description: How /available-sessions must resolve scheduleMode vs recurringSchedule, and why on-demand felt "broken".
---

# Schedule mode resolution

`GET /api/webinars/:id/available-sessions` (server/routes.ts) decides the viewer
registration UX. Explicit "watch now" modes (`scheduleMode.onDemand`,
`scheduleMode.justInTime`) MUST be checked BEFORE the recurringSchedule branch.

**Why:** Admin "enable on-demand" only mutates `scheduleMode`; it does not clear a
previously-saved `recurringSchedule`. If recurring is checked first, enabling
on-demand silently has no effect — viewer still sees recurring session picker.
Non-technical owners read this as "the button does nothing / can't pick a session".

**How to apply:** Keep onDemand → justInTime → recurring → fixed ordering. Do NOT
auto-clear recurring config when switching (it would destroy saved days/times);
precedence ordering is the correct fix.

# Admin UX
Schedule sub-section saves only flash a toast. Owners need persistent state, so the
schedule card shows a current-mode banner + per-mode "使用中" active indicators, and
session-management shows a note that on-demand/JIT need no manual sessions.
