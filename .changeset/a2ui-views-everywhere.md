---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

A2UI views show on the run page, Pulse tiles, dashboards and inbox threads.

An agent's `view:` now draws wherever its results appear: the run page's Result area, its Pulse tile (and named dashboards), and inbox threads under an action that ran it, as well as agent chat. A view takes the place of the `signal` template and output widget; an agent with only a `view:` gets a Pulse tile. If a generated view is invalid on a run, the run page says why and falls back to the output widget. The A2UI renderer now loads only on pages that show a view.
