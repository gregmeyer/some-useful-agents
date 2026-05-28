---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Inbox triage can now propose running `agent-analyzer` (the agent
behind the "Suggest improvements" button) as a sub-agent action.

When triage proposes `{type:'run-agent', agentId:'agent-analyzer',
inputs:{FOCUS:'…'}}` in its `<plan>`, the route auto-injects the
failing agent's full YAML as `AGENT_YAML` and the most recent run
output as `LAST_RUN_OUTPUT` — same enrichment the analyze route on
the agent detail page uses. Triage only has to provide a one-sentence
`FOCUS`; it doesn't have to thread the YAML through its prompt
context. The agent is lazy-imported from `agents/examples/` on first
call, so no manual install step is required.

Hooks the inbox's action loop into a real, useful agent instead of a
stub. Future allowlist entries can add their own per-agent input
enrichment using the same pattern.
