---
name: HTTP aborted-stream cleanup
description: Node response event ordering that can crash website ingestion after an apparently handled abort
---

For Node HTTP responses, retain an error listener until the stream closes, even after the containing promise has settled.

**Why:** A premature remote socket close can emit `aborted` synchronously and `error` with `ECONNRESET` on a later tick. Cleaning up every listener in the abort handler leaves that later error unhandled and can terminate the server. A mock that emits only `aborted` incorrectly appears safe.

**How to apply:** Test `aborted` followed by a deferred `error` and then `close`; verify one rejection, no uncaught error, and eventual listener cleanup. Apply the same lifecycle protection to timeout and oversized-body destruction.