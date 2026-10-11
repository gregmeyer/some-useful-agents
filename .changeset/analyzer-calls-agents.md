---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

A fix from sua can call one of your agents instead of rewriting the agent it fixes.

When sua asks agent-analyzer for a fix from a conversation, the analyzer now sees your installed agents. When an agent is missing work another agent already does, the fix adds a step that calls that agent rather than growing a prompt; a broken prompt or node is still fixed in place. The edit card now lists the change in plain words above the diff ("New step: enrich calls firmographic-research, after synthesize").
