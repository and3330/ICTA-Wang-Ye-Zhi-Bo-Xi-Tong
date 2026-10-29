---
name: MCP authorization scope
description: Product and privacy constraints for external AI access to SellCase webinars.
---

Each external-app authorization is an explicit, read-only connection to one webinar selected by its owner, not permission to enumerate the whole account. Keep this separate from member-owned external-commerce integration secrets.

**Why:** The user requested consent followed by single-webinar selection so external AI systems access only the chosen webinar without acquiring seller-console or payment capabilities.

**How to apply:** Preserve the selected-webinar boundary for every future tool, token renewal and permission change. Do not add write tools or contact-data unmasking without explicit new authorization requirements. Registration links use the configured public origin, never a caller-controlled host; do not return a link when public registration is unavailable.
