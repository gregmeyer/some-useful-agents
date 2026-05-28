---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Inbox triage can now apply YAML fixes to agents, not just suggest them.

After `agent-analyzer` completes inside an inbox triage action, the
route extracts the `<yaml>...</yaml>` block from the analyzer's
`analyze` (or `fix`) node output and auto-proposes an `agent-editor`
action card with a unified diff against the agent's current YAML.
The operator reviews the diff in-place, clicks Run, and the route
commits a new version via `agentStore.upsertAgent` (undo via the
agent detail page's version history).

- New `agents/examples/agent-editor.yaml` — minimal stub documenting
  the contract. The actual write is performed synchronously inside
  `runProposedAction` (special-cased via `ROUTE_HANDLED_AGENTS`),
  not by dispatching the DAG.
- New `transitionActionStatus` already in place from PR #388 gives
  the editor the same race-safe idempotent treatment as analyzer.
- Validation: refuses NEW_YAML that fails `parseAgent`, refuses when
  parsed id doesn't match `AGENT_ID` (prevents accidental cross-agent
  edits).
- Triage prompt updated to clarify: do NOT propose `agent-editor`
  directly — propose `agent-analyzer` and the route's auto-propose
  handles the rest.
- Unified-diff renderer in the action card (hand-rolled LCS, ~50
  LOC, no new deps) with `+`/`-`/` ` line styling.

Verified end-to-end in browser: demo-failing-agent → reply →
analyzer proposed → run → editor auto-proposed with diff →
run → demo-failing-agent committed at v2.
