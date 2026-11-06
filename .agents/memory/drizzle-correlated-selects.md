---
name: Drizzle correlated SELECT expressions
description: Single-table SELECT projection can remove column qualification inside scalar subqueries.
---

Keep outer-table references explicitly qualified in correlated scalar subqueries used as Drizzle SELECT fields.

**Why:** The single-table selection builder strips qualification from interpolated column objects, including references inside nested SQL. An intended outer ID can then resolve to the inner table's ID. Personal funnel queries returned zero counts/null timestamps despite correctly persisted events; pure aggregation tests did not catch it.

**How to apply:** Use a trusted, fixed qualified SQL identifier for the outer correlation (never caller-supplied identifiers), or a join/CTE with explicit aliases. Verify against a real database with inner IDs deliberately different from outer IDs. WHERE predicates and SELECT projections do not necessarily receive the same rewrite.
