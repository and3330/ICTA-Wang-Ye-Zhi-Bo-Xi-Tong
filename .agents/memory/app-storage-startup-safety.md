---
name: App Storage startup safety
description: Replit App Storage SDK initialization behavior that can crash an otherwise healthy Autoscale startup.
---

Constructing the App Storage SDK client immediately starts asynchronous default-bucket discovery. If the client is created while routes are registered and the storage sidecar is temporarily unavailable, that initialization can reject without an awaiting request and terminate Node.

**Why:** An Autoscale image built successfully but failed promotion because eager client construction produced an unhandled `fetch failed` rejection. The app then crash-looped and never returned 200 to the root startup probe.

**How to apply:** Instantiate the client lazily inside the first awaited upload/download/delete operation. On a rejected SDK operation, discard the failed client so a later request can initialize a fresh one. Storage availability must not gate the website's startup health.