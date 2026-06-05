---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Inbox: triage can request permission to run an agent instead of dead-ending.

Previously, when an installed agent hadn't been granted `inboxRunnable`, triage
would refuse ("I can't run X from this thread") and the operator had to go find
the agent's Config toggle. Now triage may propose running such a "candidate"
agent, and the dashboard renders it as a one-click **"Enable & run"** card:
approving it grants `permissions.inboxRunnable` to the agent (revocable from its
Config) and runs it in the same step, with output rendered inline.

The grant only happens on explicit operator approval — candidates are never
auto-run — and is scoped to installed local/community agents (never system
agents).
