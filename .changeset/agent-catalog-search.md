---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

New system agent: agent-catalog-search.

The inbox triage agent can now answer "find me an agent that does X"
by proposing a `run-agent` action targeting `agent-catalog-search`.
The dashboard auto-injects a JSON snapshot of every installed
non-system agent as `AGENT_CATALOG`, so the LLM has the full picture
without needing any file or grep tool. The search agent returns up to
5 ranked matches with a one-line `why` for each.

This unblocks discovery-style triage flows that previously dead-ended
("No suitable agent is available in the current allowlist") because
triage's allowlist only knew about analyzer + editor. Triage's prompt
now includes a short agent guide describing when to propose each
allowlisted sub-agent.
