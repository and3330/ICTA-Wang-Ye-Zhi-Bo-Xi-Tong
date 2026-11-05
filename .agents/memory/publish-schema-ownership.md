---
name: Publish schema ownership
description: Why production must not replay application SQL migrations after Publish applies its schema diff.
---

Publish owns the production application schema. Do not replay the application SQL migration journal during production startup, even when it appears to lag behind development.

**Why:** Publish created the new media tables and constraints without advancing production's Drizzle journal. Startup then attempted the same non-idempotent constraint creation and failed before serving the application. A successful deployment status did not prove readiness because the early startup probe had already answered successfully.

**How to apply:** Keep application migrations development-only, and verify the published schema through read-only metadata queries. Never repair this by modifying production migration history or adding more startup DDL. After a publish, check actual application routes/readiness, not only the platform build status or the early root probe.

The current development migration must be applied before publishing; a schema declaration or SQL file in the codebase is not enough.

**Why:** Publish compares the actual databases. A deployment can build successfully while both databases still lack columns expected by the compiled application, causing registration APIs to fail despite a healthy homepage.

**How to apply:** Check the development database matches the current application schema before publishing. Afterward, verify production metadata and a representative application API using read-only checks. Do not select a data overwrite merely to apply additive schema changes.