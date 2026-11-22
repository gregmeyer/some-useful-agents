---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Remove Pulse's unused styles.

About 490 lines of `pulse.css` styled things that no longer exist: the old tile header, footer, collapse, resize and palette controls, the configure modal's template picker and mapping form, a theme picker, schedule chips, and the old add-tile modal. They're gone. Nothing on any page looks different.
