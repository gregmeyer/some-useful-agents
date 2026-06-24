---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Inbox: the "approve YAML fix" card now appears when analyzing any agent.

After agent-analyzer produced a corrected YAML, the auto-proposed `agent-editor`
approve card was gated on `parsed.id === message.agentId`, so on a manual thread
(no message agent) or when analyzing an agent other than the thread's, no card was
created — triage kept saying "approve the queued fix" with nothing to approve.
It now targets the corrected YAML's own agent id (resolving the fix target from
the analysis, the same way #524 fixed analyzer dispatch), and only requires that
agent to be installed.
