---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Inbox triage can now WRITE to dashboards.

A new `dashboard-editor` action lets the triage agent pin an agent's signal tile
onto a user dashboard (creating the dashboard if it doesn't exist) or create an
empty dashboard — e.g. "add the weather agent to my dashboard", "make a dashboard
called Markets". It's route-handled and auto-approved like `agent-editor`, writes
synchronously, and is sequenced as one write per turn. Agents without a Pulse
signal are refused with a clear message (dashboards render signal tiles only).
Shared slug + section-layout helpers moved into core.
