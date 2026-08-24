---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Pulse tiles honour their template's default size.

`TEMPLATE_REGISTRY` declares a `defaultSize` for each of the 13 signal
templates, and `discovery-catalog.ts` reports those sizes to the build planner
so generated agents pick sensible tiles. The renderer never applied them: it
read `signal.size ?? '1x1'`, so the registry's sizes were dead config and any
`widget`, `table`, `story`, `key-value`, `comparison`, `media`, `text-image`,
`image` or `funnel` tile whose author didn't spell out a size was squeezed into
a 1x1 box the registry explicitly says should be larger.

An explicit `signal.size` and an Improve-layout hint both still win, so this
only affects tiles that had no size of their own.

The configure modal now reports the size a tile is actually rendering at rather
than a stale `1x1`, which previously meant opening and saving the modal on such
a tile silently shrank it.
