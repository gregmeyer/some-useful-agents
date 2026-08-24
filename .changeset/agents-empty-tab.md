---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

/agents no longer claims you have no agents while you have plenty.

The page computed "empty" from the active tab's results, then treated that as
an empty install: it showed the "No agents yet — create one" card and, worse,
suppressed the tab strip. An operator whose agents are all `source: examples`
landed on the default User tab, was told they had none, and lost the only route
to the ones they had.

An empty tab now says which tab the agents are actually in, with a link, and
keeps the tab strip and filter bar on screen. The genuine "no agents anywhere"
state is unchanged, as is the separate empty-search state.
