---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Fix interactive widgets resizing during state transitions.

PR #166's interactive widgets used `display: none` to hide inactive panes (asking / running / success / error / stuck), which removed them from the layout entirely. That meant the tile's height jumped between states — the form pane is one height, the spinner-only running pane is much shorter, the result is variable, the error card is somewhere in between. Asking → running → success felt jarring as the container resized twice.

Fix: switch to a CSS Grid stack. All panes share the same grid cell (`grid-template-areas: 'stack'`), so the cell's height is `max(child heights)` and stays stable across transitions. Inactive panes get `opacity: 0; visibility: hidden; pointer-events: none` instead of `display: none`, so they keep contributing to the cell sizing without affecting interaction. CTA rows also pin to the bottom via `margin-top: auto` so the Run button sits in the same place regardless of pane content.

Short panes (running, stuck, error) center vertically inside the cell so they don't anchor awkwardly to the top of an oversized container. The container also gets a `min-height: 8rem` baseline so the very first pre-run render doesn't open at zero height.
