---
"@some-useful-agents/dashboard": minor
---

**feat: connected tutorial + in-UI create surface + DAG polish (PR 1.6 of v0.15).**

Closes the gap from v0.15.0's first pass: the tutorial was a read-only status tracker and every "create X" step dead-ended at the CLI. This PR makes the dashboard an actual create surface.

### What ships

- **`/agents/new`** — dashboard form that creates single-node v2 DAG agents via `agentStore.createAgent`. Validates id, name, command/prompt. No terminal handoff.
- **`/agents/:id/add-node`** — form that appends a node to an existing agent, bumps to a new agent version via `upsertAgent`. Supports multi-node DAG authoring from the UI with a `dependsOn` checkbox set limited to existing node ids. Post-submit stays on the same form with a "Added X" flash so users can chain another node; "Done here — view DAG" exits to the agent detail.
- **Active tutorial at `/help/tutorial`** — every step now has an inline action button, not a nav link:
  - Step 1: "Create hello agent" button → POST scaffolds a minimal single-node agent → redirects to `/agents/hello?from=tutorial` so the user immediately sees the DAG + composition.
  - Step 2: "Run <first-agent> now" button → POST runs it inline, flashes the user onto the run detail.
  - Step 4: "Scaffold demo DAG" button → creates a 2-node fetch→digest demo → redirects to `/agents/demo-digest`.
  - Every step shows a **"Will create" preview card** up front so the user sees the DAG shape + commands BEFORE clicking the button.
- **Multi-hop back navigation** — new `?from=<origin>` query propagates through POST redirects (tutorial → agent detail → run detail). Back link label reflects the *original* origin, not the immediate Referer. Handles the "I ran hello from the tutorial, now the run detail should offer Back to tutorial" case.
- **DAG viewer unified + collapsible** — fixed a styling inconsistency where `/runs/:id` and `/agents/:id` rendered the DAG with different chrome (one used inline styles overriding the design-system class). Canvas now uses a dot-grid background, softer status/type tints, thinner edges, mono label font. Wrapped in a `<details open>` so deep pages can collapse the viz without scrolling past it.
- **Multi-node agent cards** on `/agents` gain an inline `<details>` revealing each node's id + type + command snippet without navigating away.
- **Contextual back link** on run detail — reads `Referer` (falls back to query param, same-origin only) and renders "← Back to runs / tutorial / agents / <agent-id>" above the page title. Off-host referers are ignored.
- **Available variables panel** on the add-node form — lists every upstream node with its claude-code template syntax (`{{upstream.<id>.result}}`) and shell env-var form (`$UPSTREAM_<ID>_RESULT`) so authors don't have to remember. Notes that structured outputs arrive in v0.16.
- **`docs/templating.md`** — reference doc for the current templating vocabulary plus a forward-looking sketch of the v0.16 structured-outputs expansion.

### Files

- New: `packages/dashboard/src/views/{agent-new,agent-add-node,tutorial}.ts`
- New: `packages/dashboard/src/routes/help.ts` scaffold endpoints (POST `/help/tutorial/scaffold-hello`, POST `/help/tutorial/scaffold-demo-dag`)
- New: `docs/templating.md`
- Modified: `views/{agents-list,agent-detail-v2,run-detail,dag-view,page-header}.ts`, `routes/{agents,runs,run-now,help,assets}.ts`, `assets/{components,screens}.css`
- `page-header.ts` grows a `deriveBack(referer, host, fromParam)` helper the routes use to produce the contextual link.

### Tests

41 total (35 → 41; +6 new):
- Scaffold endpoints create + are idempotent + show inline action buttons
- `/agents/new` renders form, creates on POST, rejects invalid id + dup id + missing prompt-for-claude-code
- `/agents/:id/add-node` renders with current nodes, appends + bumps version, rejects unknown upstream, rejects duplicate node id
- Back link renders for same-origin Referer, omitted for off-host

### Notes

- The AI-assist idea ("Suggest with Claude" / "Write with Codex") is scoped to v0.16 alongside structured outputs — it needs the declared-outputs schema to have useful context. Plan file coming.
- `/agents/new` creates single-node agents only. The chain flow (`/agents/:id/add-node`) covers multi-node authoring. Real inline drag-drop + version diff lands in PR 3 of v0.15.
