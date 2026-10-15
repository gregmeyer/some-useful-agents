---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

A node that runs out of turns answers from what it read, instead of coming back empty.

When claude stops at a node's `maxTurns`, sua resumes it once without tools and asks for its answer from what it already searched and read. The node completes with a note saying it ran out (set `onMaxTurns: fail` to fail instead). Tool-using nodes are told their turn budget. They no longer lose turns to claude's own WebFetch or Bash, which were refused in a run anyway, or to subagents that ran outside the node's limits. web-fetch now returns JSON API responses (a job board's postings with pay, in one call). Warnings on completed nodes are kept and shown. A run that completed without some optional steps says so, and so does the notebook step that ran it.
