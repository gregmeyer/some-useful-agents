---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Search again: re-run a notebook's find step for new options with one approval.

Asking sua to "re-run the search" in a notebook used to produce a card for each job board or search agent, one after another, and none of them knew which results were new. Now sua proposes one **Search again** card that runs the notebook's find step again, even when it's done. It skips the options the notebook has, files what's new, and says how many are new. A finished find step also has a **Search again →** button on the notebook page. The other steps stay where they are.
