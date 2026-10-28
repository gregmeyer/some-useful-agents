---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Update a briefing in one go, from the page or by asking sua.

A briefing's folded steps line has **Update all →** first: it runs its done profile, find and write steps again in order (Look again, Search again, Write again) as one run, then sua says in the conversation what's new since the last run. Asking sua "rerun the briefing" or "check what you found since last time" gives one **Update it** card that does the same. The step links on that line now follow the steps' order instead of last step first.
