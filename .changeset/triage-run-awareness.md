---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Inbox triage can now SEE an agent's latest run, and reports failures directly.

Triage was blind to agent run outcomes, so when an agent in a thread failed it
could only say "run it and see what happened" — the operator had to run the agent
and paste the error back. Triage now receives `FOCUS_AGENT_RUN`: the latest run
output of the agent the thread is about (the message target, or the most recent
agent a thread action touched), including a "MOST RECENT RUN FAILED" block with
the failing node and error. The kernel teaches triage to report the failure
directly (node + error) and propose the fix, instead of asking the operator to
re-run and report.
