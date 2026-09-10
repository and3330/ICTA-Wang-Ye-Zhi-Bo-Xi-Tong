---
name: Publish schema ownership
description: Why production must not replay application SQL migrations after Publish applies its schema diff.
---

Publish owns the production application schema. Do not replay the application SQL migration journal during production startup, even when it appears to lag behind development.

**Why:** Publish created the new media tables and constraints without advancing production's Drizzle journal. Startup then attempted the same non-idempotent constraint creation and failed before serving the application. A successful deployment status did not prove readiness because the early startup probe had already answered successfully.

**How to apply:** Keep application migrations development-only, and verify the published schema through read-only metadata queries. Never repair this by modifying production migration history or adding more startup DDL. After a publish, check actual application routes/readiness, not only the platform build status or the early root probe.