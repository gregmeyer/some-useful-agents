# ADR-0024: Split the monolithic build-planner into orchestrated specialist agents

## Status
Accepted

## Context

"Build from a goal" originally ran a single `build-planner` agent that, in one
LLM call, had to: interpret the goal, decide how many agents were needed, write
every agent's YAML, design dashboard sections, and reference existing agents.
One prompt owned the entire plan.

This had three problems that surfaced under dogfooding (`user:morning-briefing`,
`cocktail-of-the-day`):

1. **All-or-nothing failure.** One malformed agent in a multi-agent plan failed
   the whole plan. There was no way to keep the good agents and retry only the
   broken one.
2. **No per-agent critic loop.** The structural critic could only judge the
   whole plan. A single bad cross-reference or nested `{{outputs.X.Y}}` path
   re-fired the entire planner — expensive and slow — instead of re-drafting one
   agent.
3. **Conflated concerns.** "How many agents does this goal need?" and "write
   this one agent's YAML" are different skills. Bundling them made the prompt
   long, the output schema wide, and the failure modes hard to localize.

## Decision

Replace the single agent with three specialists behind a server-side
orchestrator (`packages/dashboard/src/routes/build-orchestrator.ts`):

1. **`goal-surveyor`** — turns the goal into a list of fragments (one per agent
   that must exist), or returns nothing when the goal is already covered by an
   installed agent.
2. **`agent-drafter`** — writes exactly one agent's YAML. Runs once per fragment,
   in parallel. Each draft is gated by its own `critiquePlan` pass and re-fired
   with critic feedback up to `MAX_DRAFT_ATTEMPTS` (3) times.
3. **`dashboard-designer`** — assembles drafted agents into dashboard sections
   and tiles when the goal needs more than one agent.

The orchestrator owns a per-process session map and a state machine
(`survey → drafting → design → assembling → done`, plus `nothing_to_build` and
`failed`). HTTP surface:

- `POST /agents/build` — start a session from a free-form goal.
- `GET /agents/build/:runId` — advance + poll the state machine.
- `POST /agents/draft-one` — single-spec fast path (no survey/design), used by
  the Improve-layout wizard to draft one missing agent inline.
- `POST /agents/build/commit` — write reviewed agents, one `agent_versions` row
  each.

The legacy `build-planner.yaml` stays in `agents/examples/` but the orchestrator
never invokes it; it's slated for removal once the split has soaked.

## Consequences

**Positive:**
- **Partial success.** A failed draft no longer poisons the plan — the UI shows a
  partial-success screen; good agents commit, failures can be skipped or retried.
- **Localized critic loop.** The critic re-fires one drafter, not the whole plan,
  so retries are cheap and the feedback is specific to one agent.
- **`nothing_to_build` instead of redundant agents.** The surveyor can decline,
  so an already-covered goal no longer invents a duplicate agent (or crashes).
- **Reusable single-spec path.** `draft-one` falls out for free and powers
  Improve-layout's Path B (draft a brand-new agent inline) without a full survey.
- **Smaller prompts/schemas per agent**, each independently testable
  (`survey-schema.ts`, `build-plan-schema.ts`, `build-plan-critic.ts`).

**Negative:**
- **More moving parts.** Three agents + an orchestrator + a session state machine
  is more surface than one prompt. Mitigated by keeping orchestration server-side
  and documented in [docs/build-from-goal.md](../build-from-goal.md).
- **Per-process session state.** Build sessions live in memory, so a daemon
  restart mid-build loses the session. Acceptable: builds are short and re-runnable.
- **Two planner concepts** (build orchestrator + layout-planner) share the
  drafter/critic but have separate routes (`*-layout-plan.ts`). Intentional —
  layout planning curates an existing surface; building creates from scratch.

## Alternatives considered

- **Keep the monolith, add partial-commit parsing** — rejected; the failure was
  structural (one prompt, one output), and salvaging partial JSON from a failed
  generation is brittle.
- **Client-side orchestration** — rejected; the state machine, critic loop, and
  sequential commits need server authority over the catalog and DB.
- **One drafter call for all fragments (batch)** — rejected; loses the
  per-agent retry granularity that motivated the split.

## References

- Handoff: `~/.claude/plans/handoff-build-orchestrator-2026-05-23.md`
- ADR-0017 (agent-analyzer self-correcting) — same critic-retry pattern, applied
  to a single agent's YAML rather than a build plan.
- ADR-0022 (output-widget schema v2) — the widget shapes the drafter targets.
- [docs/build-from-goal.md](../build-from-goal.md) — user-facing guide.
