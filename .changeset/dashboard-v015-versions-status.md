---
"@some-useful-agents/dashboard": minor
---

**feat: agent version history + status toggle + rollback (PR 2 of 5 for v0.15).**

Makes the "every save = new version" story visible and actionable. Users can now see the full history of an agent's DAG, rollback to any prior version, and toggle an agent's lifecycle state from the UI — no more dropping to the CLI for `sua workflow status`.

### What ships

- **Status dropdown** on the agent detail inspector aside — `active` / `paused` / `draft` / `archived`. Writes through `POST /agents/:id/status` → `agentStore.updateAgentMeta`. Same values the CLI accepts.
- **`GET /agents/:id/versions`** — table of every version with creation time, author, commit message, and a rollback button per non-current row. Current version is highlighted.
- **`GET /agents/:id/versions/:version`** — single-version viewer showing the DAG as it was at that point in time, with a "Rollback to this version" primary CTA.
- **`POST /agents/:id/rollback`** — reconstructs the target version's DAG and calls `createNewVersion` to produce a NEW version whose structure matches the target. Append-only: nothing is deleted, rollback is itself a versioned event.
- Agent detail inspector gains:
  - A **"history →"** link next to the version field
  - A **"Versions"** button in the action row
  - (Already had "+ Add node" from PR 1.6)

### Design choices

- **Rollback creates, doesn't mutate.** The alternative — setting `current_version` back to v1 — would hide the rollback from history. Creating a new v3 that matches v1's DAG is auditable and reversible.
- **Status is metadata, not a version.** `updateAgentMeta` doesn't bump the version because status isn't part of the DAG schema. Only structural changes produce new versions.
- **No diff view yet.** Showing a side-by-side DAG diff between v1 and v2 requires editor context to be useful; deferred to PR 3. For now, the single-version view shows each version's DAG in isolation.
- **No general-purpose `POST /agents/:id/save` endpoint yet.** Without the editable inspector (PR 3) there's no UI to trigger it, and designing the API without a consumer risks getting it wrong. Lands alongside PR 3.

### Files

- New: `packages/dashboard/src/views/versions.ts`
- New: `packages/dashboard/src/routes/versions.ts` (versions list, single version, rollback, status)
- Modified: `views/agent-detail-v2.ts` (inspector aside now has Status section + versions links), `index.ts` (mounts the new router)

### Tests

48 total (41 → 48; +7 new):
- `/agents/:id/versions` lists all versions with current marked
- `/agents/:id/versions/:version` renders the DAG as it was at that version
- Rollback creates a new version matching the target DAG, with a "Rollback to vN" commit message
- Rollback rejects invalid target version (404)
- Status toggle changes status + rejects invalid enum values
- Agent detail renders the status dropdown form + versions link

### Plan

Remaining v0.15 PRs: **3 (inspector editing + drag-drop) → 4 (settings CRUD + passphrase modal + MCP token rotate) → 5 (replay UI + states/microcopy polish)**.
