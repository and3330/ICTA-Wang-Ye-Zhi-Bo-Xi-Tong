---
name: Marketing responsive CSS order
description: Non-obvious stylesheet ordering behavior affecting SellCase marketing breakpoints.
---

Marketing component styles may be injected before the global stylesheet in the Vite development bundle. A mobile rule with the same specificity as a global desktop rule can therefore match correctly but still lose in the cascade.

**Why:** The 390px media query reported as matched, yet the desktop navigation and grid remained visible because later global rules had equal specificity. A fixed mobile drawer inside the blurred header was also constrained by the header because `backdrop-filter` created its containing block.

**How to apply:** For marketing breakpoints, use a scoped selector with higher specificity (for example, the marketing root plus the component selector), or deliberately place the responsive rule after the global rule. Keep full-screen fixed overlays outside filtered ancestors, or neutralize the filter/containing block at that breakpoint.

Floating video controls must explicitly protect both positioning and stacking from the shared button elevation styles.

**Why:** The shared hover elevation selectors override ordinary absolute-position and z-index utilities. A control can end up outside the fullscreen viewport or underneath the play overlay even when its utility classes look correct.

**How to apply:** Use the elevation escape-hatch classes or explicit positioning and z-index overrides together; verify actual pointer clicks before and after entering fullscreen, not only visibility or keyboard activation.