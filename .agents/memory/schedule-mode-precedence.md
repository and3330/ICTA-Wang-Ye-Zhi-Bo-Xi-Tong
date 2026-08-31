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
session. Keep just-in-time behavior separate unless product requirements change.

# Admin UX
Schedule sub-section saves only flash a toast. Owners need persistent state, so the
schedule card shows a current-mode banner + per-mode "使用中" active indicators, and
session-management shows a note that on-demand/JIT need no manual sessions.
