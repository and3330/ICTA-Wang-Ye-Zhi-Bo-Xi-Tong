---
name: DB worker test isolation
description: Preventing development background workers from claiming integration-test jobs.
---

DB-backed worker integration tests require a server-controlled test queue scope or a separate database. Test-only provider overrides and NODE_ENV inside the test process do not isolate shared database rows from another process.

**Why:** The running development app can claim jobs created by a test before its stubbed runner does, causing nondeterministic tests and potentially real provider requests.

**How to apply:** Scope every admission, claim, recovery, and explicit runner operation consistently. Scope cannot be selected by an untrusted request. When introducing isolation, ensure the already-running worker has loaded the scoped implementation before creating test jobs.