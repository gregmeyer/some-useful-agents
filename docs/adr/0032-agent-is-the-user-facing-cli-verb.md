# ADR-0032: `agent` is the user-facing CLI verb; `workflow` owns v2 internals

- Status: accepted
- Date: 2026-08-21
- Deciders: Greg Meyer

## Context

The CLI grew two agent namespaces as the v2 (DAG) model landed alongside v1:

- `sua agent list|run|audit|edit|disable|enable|install` — the original surface,
  backed by `loadAgents`, the **V1 loader**.
- `sua workflow list|run|show|import|export|replay|logs|status|rm` — added for v2,
  backed by `AgentStore` (the run DB).

`loadAgents` silently skips every v2 file (`id` + `nodes[]`) and returns no
warning for the skip. Nothing surfaced the split, so from the operator's seat:

```
$ sua agent run agent-drafter
❌  Agent "agent-drafter" not found.
Run "sua agent list" to see available agents.

$ sua agent list
3 agent(s)          # …while the store held 118 v2 agents
```

The agent existed, was active, and ran fine under `sua workflow run
agent-drafter`. The failure message actively misdirected: it pointed at a list
that could never contain what the user wanted. `sua agent reimport <file>`
reported success and *still* left `agent run` unable to find the agent, which
made the whole thing read as a broken install rather than a naming split.

This is the third consumer bitten by the same silent skip. The first was the CI
`validate-agents` job, which validated **zero** agents for months while printing
a green success line (fixed in #630). The second was `sua agent list`. Each was
diagnosed independently, from scratch, because nothing recorded the rule.

## Decision

**`agent` is the user-facing verb for both models. `workflow` keeps the
v2-internals verbs.**

1. `sua agent run <name>` resolves v1 first, then falls through to the v2 store.
   A v2 hit executes on the same path `sua workflow run` uses.
2. `sua agent list` shows v1 and v2 in one table with a `Model` column
   (`v1` / `v2`). The count is the total.
3. `sua workflow` is **not** deprecated and prints no nag. It keeps the verbs
   that have no `agent` equivalent and are genuinely v2-shaped: `import`,
   `import-yaml`, `export`, `replay`, `logs`, `show`, `rm`, `status`.
4. Both verbs share one execution path, `packages/cli/src/v2-runtime.ts`. There
   is exactly one copy of the store wiring.
5. A v2 agent reached through `agent run` rejects `--provider temporal` rather
   than accepting the flag and quietly running locally.

## Consequences

**Good.** The verb people reach for first works. The error message tells the
truth. New verbs get written once, not twice — the duplicate `openStores` /
`loadLlmSettingsSnapshot` / execution wiring would have drifted the moment
either side grew a store, and one of the two would have been the wrong one.

**Cost.** `agent list` now opens the run DB, so it is marginally slower and can
fail where it previously could not. `listV2Agents` swallows store errors and
returns `[]` for that reason: a missing or locked DB degrades the listing to
v1-only rather than erroring out a read-only command.

**Not addressed.** The other `agent` verbs are still v1-only: `audit`, `edit`,
`disable`, `enable`, `secrets`, `doctor`, `schedule`. Each needs its own
decision about what the operation even means for a DAG (what does `edit` do to a
multi-node agent — open which file?), so they are deliberately out of scope here
rather than half-converted. `agent list --catalog` also stays v1-only: it reads
the community YAML **directory**, which is a different thing from the imported
store.

**The underlying trap stands.** `loadAgents` still skips v2 silently. This ADR
routes around it at the CLI boundary; it does not fix the loader. Any *new*
caller of `loadAgents` that means "all agents" will be wrong in exactly the same
way. Prefer `AgentStore` + `parseAgent` for anything user-facing.

## Alternatives considered

**Signpost only** — leave routing alone, make the error say "this is a v2 agent,
use `sua workflow run`". Smallest change, and it fixes the misdirection. Rejected
because it makes the operator learn an internal implementation split to run an
agent they can already see in the dashboard. The split is ours, not theirs.

**Unify and deprecate `workflow run`/`list`** — collapse to one verb outright.
Rejected: it breaks muscle memory and scripts for no functional gain, and
`workflow` still has to exist for import/export/replay/logs, so the surface does
not actually shrink.

**Fix `loadAgents` to return v2 agents too** — the deepest fix. Rejected for
now: `AgentDefinition` (v1) and `Agent` (v2) are different types with different
execution paths, so every one of the ~20 `loadAgents` call sites would need to
handle a union. That is a much larger change than the bug warrants, and several
call sites (`workflow import`, which migrates v1 → v2) genuinely want v1 only.
