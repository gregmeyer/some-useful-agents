---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

v0.21.0 — integrations, the Improve-layout wizard, the build-from-goal orchestrator, and widget controls everywhere.

This release rolls up the work since v0.20.0. Headline additions: a Settings → Integrations
surface with CSV / Postgres / SQLite / Gmail (OAuth) kinds and auto-generated tools; the
Improve-layout wizard on Pulse and any named dashboard (Path A adds installed agents, Path B
drafts new ones inline); the build-from-goal planner split into a `goal-surveyor` +
per-fragment `agent-drafter` (each behind its own critic) + `dashboard-designer` orchestrator;
output-widget controls (`sort` / `filter` / `paginate` / `field-toggle` / `view-switch` / `replay`)
that render everywhere and are restylable by the widget author; per-node Advanced LLM options
(provider, model, maxTurns, allowedTools); and the `llm-prompt` node type (canonical rename of
`claude-code`, with the old name preserved as an alias). Plus dashboard polish — tile first-run
auto-execution, in-place "Run again", a one-click CSP image-allow modal, and a build stamp.
