---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Build-from-goal v3 — bias the planner toward multi-agent / multi-node
composition over rebuilding monoliths.

When a goal looks like *primitive × list-of-inputs* AND the catalog
already has a matching primitive, the planner now proposes ONE
orchestrator that wraps the existing primitive via `loop` +
`agent-invoke`, instead of drafting parallel near-duplicate agents.

Live verification: prompt *"Find me senior product manager roles
across rula, ramp, notion, and linear, and refresh weekly"* now
produces a single `pm-role-tracker` orchestrator that does
`agent-invoke ashby-jobs-multi` (the existing primitive) on a
weekly schedule — not a fresh rewrite.

Changes:
- **`agents/examples/build-planner.yaml`** — adds a STEP 3b
  ("COMPOSE OVER EXISTING AGENTS") with the `loop + agent-invoke`
  recipe and an explicit anti-pattern callout for "two near-identical
  primitives." Uses angle-bracket placeholders (`«inputs.X»`) in the
  recipe pseudocode so the agent-yaml validator doesn't try to resolve
  the example template references against the planner's own scope.
- **`packages/core/src/discovery-catalog.ts`** — AVAILABLE AGENTS
  section header now ends with: "ANY AGENT HERE IS LOOP-INVOKABLE…"
  + the per-iteration `$item.<field>` mapping syntax.
- **NEW** `agents/examples/ashby-jobs-multi.yaml` — multi-company
  Ashby orchestrator (3 nodes: discover → fetch → explain).
  Inlined per-company logic; suitable as a worked example of the
  monolithic alternative the planner can now compose AROUND.
- **EDIT** `agents/examples/ashby-job-finder.yaml` — strip the
  `{{inputs.X}}` from `signal.title` (the renderer doesn't substitute
  input values into signal titles, so the literal string was showing
  on tiles). Comment in the file documents WHY for the next reader.

Catalog size budget bumped 11000 → 12500 chars to absorb the new
composition guidance (~500 chars).
