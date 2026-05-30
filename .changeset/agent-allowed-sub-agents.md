---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

feat: per-agent allowedSubAgents allowlist + picklist UI on /agents/:id/config

Previously the only "sub-agents this agent may propose" allowlist was a
hardcoded const in `routes/inbox.ts` (`TRIAGE_SUB_AGENT_ALLOWLIST` —
`agent-analyzer`, `agent-editor`, `agent-catalog-search`) feeding the
inbox-triage agent's `ALLOWED_SUB_AGENTS` input. Operators couldn't
customize it without editing code.

This PR adds a first-class `allowedSubAgents?: string[]` field on the
Agent schema:

- **Type + schema + YAML round-trip.** Added to `Agent`,
  `AgentVersionDag`, the Zod schema (with kebab-case validation), the
  YAML import/export, and the agent-store DAG serialisation.
- **Runtime wiring.** `getSubAgentAllowlist` in `routes/inbox.ts`
  reads `triage.allowedSubAgents` first when set; falls back to the
  hardcoded system-agent list when undefined. Empty array = "text-
  only, no sub-agents allowed."
- **New route.** `POST /agents/:id/allowed-sub-agents` saves a comma-
  separated `agentIds` list (validates kebab-case, drops self-
  references and duplicates) or accepts `clear=1` to revert to the
  platform default.
- **Config UI.** New "Allowed sub-agents" card on
  `/agents/:id/config`: shows the current list as removable pills,
  warns when entries aren't installed, exposes "Pick agents…" /
  "Revert to default" buttons. A picklist modal (search + agent
  cards, mirrors the Add Tile pattern) lets the operator stage
  multiple additions before saving.
- **Tests.** 6 new route tests cover save / dedupe / self-reference /
  empty list / clear / not-installed-warning paths. Full suite 1791
  passing.
