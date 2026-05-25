---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Show interactive output widgets on Pulse/dashboard tiles even when `signal.template` isn't `widget`.

Pulse dispatches tile rendering on `signal.template`, so an agent that declared
an interactive `outputWidget` but left `signal.template` as e.g. `text-headline`
(several shipped examples do) rendered an empty slot template instead of the
widget on first view. Interactive widgets are tile-level mini-apps that render
without a prior run, so they now always own the tile. Non-interactive widgets
paired with a compact `signal.template` (e.g. a metric tile) are unchanged.
