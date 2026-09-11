---
name: Order fulfillment concurrency
description: Why provider payment changes participate in optimistic order edits without rewriting past fulfillment.
---

Payment callbacks and seller edits must share the order concurrency boundary. A payment or refund update must invalidate an older seller edit, not only another seller edit.

**Why:** A seller may open a paid order, then submit completion after a refund has reduced its net payment to zero. Versioning only manual operations permits that stale action even when the completion handler checks payment state.

**How to apply:** Version genuine provider-visible changes and check the version while serializing seller updates. Duplicate unchanged provider evidence should not create duplicate history. Completion eligibility applies to new actions: a later refund must not erase an earlier, legitimate fulfillment history. Stopping fulfillment is never itself a payment cancellation or refund.