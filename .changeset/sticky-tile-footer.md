---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Fix pulse tile footer being overlapped by tall interactive widgets.

When a tile renders an interactive widget whose inputs form is taller than the tile's `max-height: 400px`, the footer (agent link + run age) used to scroll with the content and end up visually overlapped by the form fields — making the agent link unreachable and the timestamp invisible.

`.pulse-tile__footer` now uses `position: sticky; bottom: 0; background: var(--color-surface)` so it pins to the bottom of the visible tile area regardless of how tall the body is. `margin-top: auto` is preserved so it still sits at the bottom of the flex column when content is short.
