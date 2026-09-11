---
name: Management financial browsing
description: Why management order browsing keeps each payment category independently paginated.
---

Browse platform invoices, AI purchases, and member sales as separate payment categories. Do not merge individually paginated provider/local results and truncate the combined page.

**Why:** That approach silently drops transactions: discarded rows from one source's first page never appear on its second page. It also encourages confusing platform revenue with money received directly by members.

**How to apply:** Retain explicit category selection and pagination. A future all-payments view needs a genuinely unified ordered cursor or reconciled index, with provider availability reported separately from an empty result.