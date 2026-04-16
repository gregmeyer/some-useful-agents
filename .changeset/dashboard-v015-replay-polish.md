---
"@some-useful-agents/dashboard": minor
---

**feat: replay on DAG click + node action dialog + template palette + polish (PR 5 of 5, closes v0.15).**

Turns the DAG viz into the primary interaction surface (not a decoration above a table), adds a command-palette style autocomplete to node command/prompt textareas, and tightens the empty/error states the earlier PRs in this bundle didn't quite nail.

### Node action dialog

- **Click any DAG node** on `/runs/:id` or `/agents/:id` to open an action dialog. Dialog shows the node's id, type badge, status badge (run detail only), depends-on list, and duration — plus context-specific action buttons.
- **On `/runs/:id`** (terminal runs only): "Replay from here" button POSTs to `/runs/<priorRunId>/replay` with the clicked node as `fromNodeId`. Community shell agents add a confirm prompt + the audit flag. "Jump to details" scrolls to the per-node card below.
- **On `/agents/:id`**: "Edit node" link jumps into `/agents/:id/nodes/:nodeId/edit`. When a latest completed run exists, "Replay from here" points at that run for one-click re-execution.
- Uses the browser-native `<dialog>` element so ESC + backdrop clicks + focus return are free.
- Replaces the misleading "Click a node to inspect it" inspector hint — the interaction now actually exists and the hint tells the truth.
- Below-DAG "Replay" form is now a `<noscript>` fallback for users without JS.

### Template palette (autocomplete for `$` and `{{`)

- Typing `$` in a **shell** textarea opens a floating palette with every available env-var injection:
  - `$UPSTREAM_<ID>_RESULT` for each other node in the agent
  - `$<INPUT>` for every declared agent-level input
  - `$<SECRET>` for every secret declared on the node
- Typing `{{` in a **claude-code** prompt textarea opens the same idea with template refs:
  - `{{upstream.<id>.result}}` per upstream node
  - `{{inputs.<NAME>}}` per agent input
- Keyboard: Up/Down to navigate, Enter/Tab to insert, Esc to close. Substring match + position-scored ranking.
- Suggestions are computed server-side from the agent's node list + declared inputs + per-node secrets, embedded as a JSON payload in a `<script type="application/json">` tag — same pattern Cytoscape uses for its element payload.
- Wired into both `/agents/:id/add-node` and `/agents/:id/nodes/:nodeId/edit`. Friendly inline hint below each textarea.

### Replay / empty / error polish

- `POST /runs/:id/replay` — validates prior run is a v2 DAG run + agent exists + node is valid; dispatches `executeAgentDag` with `replayFrom`; 303s to the NEW run's page on success, flashes back to the prior run on failure.
- `/runs` with zero runs renders a dedicated "No runs yet" card pointing to the Agents page + CLI. `/runs?agent=ghost` (filters + no matches) renders "No runs match" + a Reset filters link.
- `/runs/<missing>` 303-redirects to `/runs` with a flash explaining the run may have been pruned by the retention policy. No more raw `<p>` fallback.
- `/runs/:id` surfaces flash banners for replay errors via an error-vs-ok regex classifier in the route.

### Design notes

- **Dialog chosen over popover.** The browser-native `<dialog>` element handles ESC, backdrop clicks, and focus return without extra JS. Building a custom popover positioned over a Cytoscape canvas gets messy fast.
- **Replay always redirects to a new run.** Even on executor-side validation failure (missing upstream snapshot), the executor creates a failed run row for the audit trail. The dashboard flashes back to the prior run's page for those cases to keep the flow consistent.
- **Palette doesn't filter by `dependsOn:` checkboxes.** Users can type a reference to a node they haven't yet marked as an upstream; save-time Zod validation catches it. Wiring the palette to live checkbox state adds complexity without clear value — the "helpful error at save" path already exists.
- **Palette is inline JS, not a new asset.** The handler is ~180 lines; adding a second `/assets/*.js` file for it adds a network round-trip without material benefit. When the palette grows (v0.16 structured-outputs will add path completions), promote to its own asset file.

### Files

- New: `packages/dashboard/src/routes/run-mutations.ts` (replay route), `packages/dashboard/src/views/template-palette.ts` (suggestions helper + payload renderer)
- Modified: `views/dag-view.ts` (replay/editBase props + `<dialog>` shell), `routes/assets.ts` (node-click dialog logic in `graph-render.js` + additional per-node data), `views/run-detail.ts` (replay context + noscript fallback, removed inline replay form), `views/agent-detail-v2.ts` (editBase + replay wiring + honest hint), `views/agent-add-node.ts` + `views/agent-edit-node.ts` (palette wiring), `views/js.ts` (palette client), `routes/runs.ts` (flash classification + 303 on missing run), `views/runs-list.ts` (empty-state split), `assets/screens.css` (dialog + palette styles), `index.ts` (wire run-mutations router)

### Tests

87 dashboard tests total (75 → 87; +12 new):
- DAG wires `data-replay-run-id` on completed v2 runs + `<dialog>` shell present + click-hint rendered
- No replay wiring on in-progress runs
- Agent detail wires edit-base + replay-latest + replaced misleading inspector hint
- `POST /replay` — missing node, unknown node, valid node, cross-origin refusal
- `GET /runs/<missing>` redirect
- Empty / filtered empty states
- Palette JSON payload on add-node form (all candidate upstreams)
- Palette JSON payload on edit-node form excludes the node under edit

### Plan

v0.15 is feature-complete with this PR. Release work (changeset consolidation, CHANGELOG polish, version bump) happens via the Changesets release PR (#64). Post-v0.15: see `~/.claude/plans/agents-as-packages.md` and `~/.claude/plans/dashboard-revamp.md` for where this is heading.
