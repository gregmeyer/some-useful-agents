---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Fix: inbox triage can analyze any agent, not just the thread's target.

agent-analyzer's preflight node hard-requires AGENT_YAML, which the inbox route injected only from
the thread MESSAGE's agentId. So on a manual thread (no agentId) — or when triage wanted to analyze
a different agent than the thread's target, e.g. one it just built — the YAML was never injected
and every analyzer run failed at preflight ("Process exited with code 1"). The route now resolves
the target from an explicit `AGENT_ID` in the action inputs (falling back to the thread's agentId),
injects that agent's YAML, and refuses up front with a clear message when no agent can be resolved
instead of dispatching a doomed run. The triage kernel teaches setting `AGENT_ID` to the agent to
analyze.
