---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

feat(dashboard,examples): triage dispatches agent-builder with auto-injected catalogs

Closes the gap flagged in PR #411: when the operator asks triage to
"build me an X agent" and no installed agent matches a prior catalog-
search, triage now proposes an `agent-builder` action instead of
telling the operator to run `/build` themselves.

### What landed

- `agent-builder` is now in `TRIAGE_SUB_AGENT_ALLOWLIST`,
  `TRIAGE_AUTO_APPROVE_AGENTS`, and `SYSTEM_AGENT_IDS`. The proposal
  auto-runs on emit (no operator click), the commitment chip pulses
  through the run, and catalog-search hides it from results so it
  isn't recommended as a generic match.
- New `enrichAgentBuilderInputs` helper in `routes/inbox.ts` injects
  `AVAILABLE_TOOLS` (formatted tool catalog) + `DISCOVERY_CATALOG`
  (built via `buildDiscoveryCatalog` from agent + tool + template +
  dashboard + pack stores). Mirrors the `/agents/new` "Build from
  goal" flow's input shape so triage-dispatched builds see the same
  context as the dashboard button path.
- `inbox-triage.yaml` prompt now documents `agent-builder` under the
  Agent guide:
  - Pass `GOAL` verbatim from the operator's request.
  - `FOCUS` is opt-in for genuine constraints only.
  - Auto-injection is called out so triage doesn't try to thread the
    catalogs through `inputs`.
  - Order-of-operations rule: propose `agent-catalog-search` FIRST
    when the operator names a topic, then propose `agent-builder`
    only after a confirmed miss (or when the operator explicitly
    asked for a fresh build).
- Added an `agent-builder` example to the OUTPUT FORMAT block with
  the right `commitmentSummary` shape ("drafting trivia-night
  agent").

After restart, triage stops bouncing operators to `/build` for
"build me an agent" requests — Layer 2 auto-approves the proposal,
the chip pulses while it runs, and Layer 3 wraps with a summary the
operator can act on.
