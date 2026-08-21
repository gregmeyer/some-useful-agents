---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Show behavior conditioning in the dashboard.

Agent detail now has a **Held to** row listing the behaviors an agent declares, each linking to its spec. A declared behavior that cannot condition a run — missing, or found only in your home directory or an org registry — is marked **unusable**, with a note that the agent will fail to run until it resolves. Previously that only surfaced as a failed run.

Run detail now has a **Conditioned by** row naming the behaviors that were in force. Runs have recorded this since conditioning shipped; nothing displayed it, so a trace could not be audited against the standards that supposedly applied.
