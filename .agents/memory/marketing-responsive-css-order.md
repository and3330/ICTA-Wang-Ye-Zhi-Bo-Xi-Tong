---
name: Marketing responsive CSS order
description: Non-obvious stylesheet ordering behavior affecting SellCase marketing breakpoints.
---

Marketing component styles may be injected before the global stylesheet in the Vite development bundle. A mobile rule with the same specificity as a global desktop rule can therefore match correctly but still lose in the cascade.

**Why:** The 390px media query reported as matched, yet the desktop navigation and grid remained visible because later global rules had equal specificity. A fixed mobile drawer inside the blurred header was also constrained by the header because `backdrop-filter` created its containing block.

**How to apply:** For marketing breakpoints, use a scoped selector with higher specificity (for example, the marketing root plus the component selector), or deliberately place the responsive rule after the global rule. Keep full-screen fixed overlays outside filtered ancestors, or neutralize the filter/containing block at that breakpoint.