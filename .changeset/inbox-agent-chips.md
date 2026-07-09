---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Inbox threads show a chip for every agent they reference.

The thread header now renders one navigable chip per agent the conversation
touches — the target agent plus every proposed/executed action's target —
instead of just the single target-agent link. Duplicates collapse and triage
scaffolding (agent-editor, dashboard-editor, the resolve sentinel, …) is
excluded, so a multi-agent thread surfaces the real agents at a glance, each
linking to `/agents/<id>`.
