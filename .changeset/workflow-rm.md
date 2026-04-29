---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

`sua workflow rm <id>` and dashboard delete — hard-delete agents.

Closes the gap where `archive` was the only way to "remove" a v2 DB-backed agent. Archived agents stayed visible in `sua workflow list` and held the id namespace, making test fixtures and abandoned agents hard to clean up.

- New CLI verb `sua workflow rm <id>` shows agent metadata (status, source, version count, run count + last fire, schedule), then a `[y/N]` confirmation prompt. `--yes` skips the prompt for scripts.
- New dashboard "Danger zone" disclosure section on the agent overview tab. The form requires the operator to **type the agent id verbatim** before the browser will submit — the input's `pattern` attribute enforces the exact match. The route also re-validates the confirm token server-side, so a client bypassing the form still can't accidentally delete.
- Both surfaces use the existing `AgentStore.deleteAgent`, which cascades to `agent_versions` rows but leaves runs intact (runs reference agent id as a string, no FK). Run history is preserved as append-only — clicking the agent column in /runs for a deleted agent now 404s with a "this agent has been deleted" hint, but the run row itself is still inspectable.

Refuses to delete an agent that's invoked by another agent's `agent-invoke` node (existing core behavior — the error message names the dependent agents). No `--purge-runs` or cascade-runs flag; orphan-cleanup is a separate utility (deferred).
