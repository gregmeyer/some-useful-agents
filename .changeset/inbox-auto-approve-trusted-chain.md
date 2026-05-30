---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

feat(dashboard): auto-approve trusted sub-agent chain from triage

When triage proposes an action against a known-safe system agent
(`agent-analyzer`, `agent-editor`, `agent-catalog-search`), the action
card now transitions straight from `proposed` to `running` without
waiting for an operator click. Anything outside this set still requires
manual Run.

The transition uses the same atomic `transitionActionStatus` pattern as
the manual /run route, so a concurrent operator click no-ops idempotently.
The Layer 1 commitment chip stays pulsing through the run; on completion,
the existing `runProposedAction` path publishes the terminal
`action:status` event exactly as it would after a manual click.

Layer 2 of the triage follow-through plan
(`~/.claude/plans/triage-follow-through.md`). Layer 3 (sub-agent
completion re-invokes triage for a wrap-up turn) ships next.
