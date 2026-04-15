---
"@some-useful-agents/dashboard": minor
---

**feat: node edit + delete in the dashboard (PR 3a of 5 for v0.15).**

Closes the last big create/edit gap: users can now modify existing nodes and remove them without dropping to YAML or the CLI. Every change becomes a new version in the audit history.

### What ships

- **`GET /agents/:id/nodes/:nodeId/edit`** — form pre-filled with the node's current state (type, command/prompt, dependsOn). Node id is **read-only** — renaming would break every `{{upstream.<id>.result}}` / `$UPSTREAM_<ID>_RESULT` reference in the same agent. Users who want a different id delete + re-create.
- **`POST /agents/:id/nodes/:nodeId/edit`** — validates + writes a new version via `createNewVersion`. Commit message is auto-set to `Edited node "<id>"`. Cycle guard re-runs server-side; the form's picker already hides downstream nodes but a hand-crafted POST can't bypass it.
- **`POST /agents/:id/nodes/:nodeId/delete`** — removes the node + creates a new version. Refuses if:
  - Any other node depends on this one (clear flash: `Cannot delete "fetch" — "digest" depends on it.`)
  - The agent has only one node (delete the agent itself from the CLI instead)
- **Inline Edit + Delete buttons** on every row of the agent detail Nodes table.

### Design notes

- **Node ids are immutable.** The form shows them in a disabled input with a hint explaining why. Rename becomes delete-and-recreate.
- **Downstream-dep check on delete is explicit, not cascading.** Auto-trimming dependents' `dependsOn` would silently reshape the DAG; a loud refusal makes the user confront the consequence.
- **Cycle guard uses colored-DFS.** Faster than re-running the full Zod schema for one topology check; re-validates only the edge under consideration.
- **Fields not yet editable from the UI** (inputs, secrets, env, envAllowlist, allowedTools, model, maxTurns, timeout, redactSecrets) are preserved on edit — the form keeps them untouched, so editing a shell node's command doesn't wipe its secrets. Those land in PR 3b (the richer inspector) alongside drag-drop.

### Files

- New: `packages/dashboard/src/views/agent-edit-node.ts`
- Modified: `packages/dashboard/src/routes/agents.ts` (GET + POST for /edit, POST for /delete, plus `hasCycleAfterEdit` helper); `views/agent-detail-v2.ts` (Edit/Delete buttons on node rows + new Actions column)

### Tests

55 total (48 → 55; +7 new):
- GET edit pre-fills the form + id input is read-only
- POST edit updates the node + bumps the version + leaves downstream alone
- POST edit refuses a cycle-producing dependsOn with a 400
- POST delete refuses when any node depends on the target
- POST delete removes the node + bumps the version when nobody depends on it
- POST delete refuses to remove the last node (1-node agent)
- Agent detail renders Edit + Delete buttons on every row

### Plan

Remaining v0.15 PRs: **3b (DAG drag-drop visual, deferred as its own PR) → 4 (settings CRUD + passphrase modal + MCP rotate) → 5 (replay UI + polish)**. v0.16 plan for structured outputs + Claude/Codex AI-assist comes after v0.15 wraps.
