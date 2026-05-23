---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Give dashboard users more in-app context, and fix stale node-type labels.

Adds compact, dismissible one-line intros to the Home, Pulse, and Integrations
surfaces (dismissal persists in localStorage), a guided empty state on Home when
no agents exist, and an actionable "no runs yet" state on the agent Runs tab.
Fixes rendered terminology: `llm-prompt` nodes are no longer mislabeled as
`claude-code` (node badges, control-flow "goes to" badges, the shared type
badge, the /nodes catalog, and DAG node coloring all show the canonical name;
`claude-code` is still accepted as the legacy alias).
