# ADR-0030: Outcome detection as a post-run observer, not a node

## Status

Accepted

## Context

sua knows when an agent finished. It does not know what happened because the agent ran.

`runs.status` answers "did the last node exit 0". That is execution telemetry. It is not
an answer to "did the thing we wanted actually happen", and treating it as one is the
single most misleading thing an agent system can do — an agent that produces an empty
digest, posts nothing, and exits 0 reports exactly the same status as one that worked.

Three things existed nearby, none of which closed the gap:

- **`successCriteria`** (ADR-adjacent, `agent-loop/eval-criteria.ts`) — four
  deterministic criterion kinds evaluated after each run, used to drive a *re-run loop*.
  It is a control input, not an observation. It also did not work: `parsedToAgent`,
  `AGENT_KEY_ORDER`, `AgentVersionDag`, `extractDag`, and `mergeRowWithVersion` all
  dropped the field, so it validated in YAML and then vanished before the store saw it.
  `executeAgentLoop` had been a permanent pass-through for its whole life.
- **`agent_memory`** — per-iteration observations, written since it shipped and never
  read, because no read surface was built.
- **The planner loop** — a genuine observe/evaluate/reflect cycle, but scoped to plan
  construction, not to what a running agent produces.

We need a reusable protocol for turning execution into evidence-backed outcome records
that can later support evaluation and learning.

## Decision

Ship OutcomeDetection v0.1 as a **post-run observer** built from existing primitives.

### Where it attaches

A new optional `deps.onRunComplete` hook at the tail of `executeAgentDag`, mirroring the
existing `onRunFailure` but firing on success and failure alike, awaited, and wrapped so a
broken observer cannot change a committed result. `outcome/hook.ts` provides the adapter;
the executor knows nothing about outcomes.

`executeAgentWithRetry` and `executeAgentLoop` each fire it **once** for their whole
chain, so a 3-attempt retry or a 3-iteration eval loop yields one record, not three.

### Why not a node type

Outcome detection must observe the whole run *including its own failure*. A node inside
the DAG cannot observe a DAG that failed before reaching it.

### Why not a required agent interface

That would force every agent to implement outcome logic. Detection is opt-in per agent
via an `outcome:` block; the hook is a no-op for agents that declare none, so it can be
registered globally at zero cost.

### Why not inside `executeAgentLoop`

That loop only engages when `successCriteria` exist, and it is a *control* loop.
Detection must fire for every run, including single-shot ones.

### Four information tiers, kept separate

`declared` (before the run) / `observed` (during) / `inferred` (after, by an LLM) /
`evaluated` (after, by rules). Collapsing these into one prose summary would discard the
only property that makes a record worth keeping. Anything unfillable becomes a typed
`unknowns[]` entry — the record never guesses.

### Evidence grounding is mechanical

The optional LLM judge sees **only** the evidence bundle — never the run, the node
records, or the agent definition — and must cite evidence ids for every claim. Those
citations are then validated against the bundle: a claim citing something that does not
exist is **dropped**, confidence is forced to `low`, and an `ungrounded-claim` unknown is
recorded. Grounding is enforced by the code, not requested in the prompt.

Deterministic criteria always beat the judge on the verdict; disagreement is recorded as
`judgeDisagreedWithCriteria` rather than smoothed away.

### Reuse over invention

`outcome.success` is the existing `AgentSuccessCriterion` union, evaluated by the existing
`evaluateCriteria`. The repo already had two predicate grammars (`AgentSuccessCriterion`
and `OnlyIfCondition`); adding a third would have been worse than the duplication it
avoided. As a prerequisite, the five-site round-trip drop of `successCriteria` /
`maxLoopIterations` was fixed — the same plumbing `outcome:` needs.

### Author-declared blind spots

`outcome.unobservable[]` names parts of an expectation sua provably cannot observe. Each
entry becomes an unknown with reason `not-observable-post-hoc` and forces the verdict away
from `yes`.

This field exists because of the most important thing the first implementation taught us:
**a detector cannot infer its own blind spots from a prose expectation.** Everything else
in a record can be reconstructed after execution from what sua already persists. What
cannot be reconstructed is the knowledge that something *mattered and was never captured*.
That has to be declared up front.

## Why learning is out of scope

The conceptual loop is intent → execution → observation → evaluation → learning. v0.1
implements the first four and stops.

1. **Detection must earn trust before it is allowed to feed back.** A system that modifies
   prompts based on outcome records it cannot yet be shown to get right is worse than one
   that modifies nothing.
2. **One outcome is not a pattern.** Belief change and process change require cross-run
   aggregation, which is a *consumer* of the record stream, not part of detecting a single
   outcome. Putting it inside the detector would couple two things with completely
   different data requirements.

`OutcomeRecord.followUp[]` exists and is inert: nothing in sua reads it to modify an
agent, prompt, or config.

## v0.2 — what consumes records

v0.1 produced records nothing read, which is how `agent_memory` became write-only
dead weight. v0.2 makes them load-bearing. The architectural decision above is
unchanged; only its consumers are new.

**Verification stopped equating completion with success.** `verifyResolveEvidence`
— the function that decides whether a triage fix worked, and thus whether an inbox
thread auto-resolves — answered `ok` for any run that reached `completed`. A thread
closed as "fixed" for an agent that ran perfectly and produced nothing. It now reads
the outcome record when the agent declared one, falling back to run status
otherwise. `undetermined` maps to `pending`, never `ok`: not being able to tell
whether something worked must not close a thread.

**A new inbox source, `outcome`, for the silent-failure class only.** Raised when a
run COMPLETED (so `run-failure` never fired) and missed its declared outcome. Never
on failed runs, and never on `undetermined` — raising on "we couldn't tell" is how
an inbox trains people to ignore it. `medium` priority, coalesced per agent, with a
`SUA_INBOX_OUTCOME_MISSES=0` escape hatch mirroring the run-failure one.

**Records surface where the run already lives** — `/runs/:id` renders the record
above the raw result, and inbox threads render a compact form of the same view.
One renderer serves both so they cannot drift.

**Triage sees intent.** A `FOCUS_AGENT_OUTCOME` input sits beside the existing
`FOCUS_AGENT_RUN`, so triage can distinguish "produced plausible output" from
"produced what it was supposed to".

**`OUTCOME_FEEDBACK` feeds the next run** — the cross-run analogue of
`LOOP_FEEDBACK`. Opt-in by construction (an undeclared input is dropped by
`mergedInputs`), reads only the immediately-previous run, and emits nothing for an
`undetermined` outcome. Still context for one run, not a modification: the line
below holds.

## Consequences

### Positive

- Adding detection to an existing workflow is an `outcome:` block plus one dep — no new
  framework, no per-agent code.
- Records distinguish observed evidence → inferred outcome → evaluation, with resolvable
  provenance pointers, so a claim can always be checked.
- Non-achievement is detectable: absent evidence is recorded rather than dropped, and
  `undetermined` is a first-class verdict.
- `successCriteria` works in production for the first time; criterion and selector node
  ids are now validated at import instead of failing silently at eval time.
- Detection is measurable. A labelled 12-run fixture scores grounding, recall, false
  outcome rate, missing-state detection, and evaluation accuracy, including under
  adversarial judges.

### Negative

- **Evidence is not world state.** sua has no artifact abstraction; evidence comes from
  `node_executions`, the `runs` row, and filesystem probes. Side effects that leave no
  trace in those places are invisible.
- **Coverage is `completed | failed` only.** Runs finalized outside the executor (a Stop
  the abort didn't land, orphan-reaper finalization) produce no record.
- **Value redaction is prefix-based.** `redactKnownSecrets` catches known credential
  shapes, not arbitrary opaque secrets an agent prints. Enabling the LLM judge ships
  evidence values off-machine.
- **Judge-only runs can overclaim.** Where no deterministic criteria exist, the judge is
  the verdict; the `unobservable` guard downgrades `yes` → `partial` but cannot reach the
  truthful `undetermined`. Measured and asserted, not hidden.
- Adding `outcome` to `extractDag` makes it part of the DAG-equality check, so an agent
  that gains the block bumps a version on first re-import.

## Alternatives considered

**An `outcome-detection` node type appended to every DAG.** Rejected: cannot observe a run
that failed before reaching it, and pushes wiring into every agent.

**A dedicated detector agent invoked via `agent-invoke`.** Rejected: makes detection cost
an LLM call unconditionally, and inverts the dependency — the thing observing the run
would itself be a run needing observation.

**Storing outcomes in `agent_memory`.** Rejected: that table is keyed by loop iteration and
scoped to the control loop. Outcome records are per-run and exist independently of whether
an agent loops.

**Requiring an LLM judge.** Rejected: makes every record nondeterministic and token-costly,
and makes the capability's own evaluation impossible to run offline. Deterministic first,
judge as an opt-in overlay.

**Inferring blind spots from the expectation text.** Rejected: that is precisely the
fabrication this design exists to prevent. Declared instead.

## References

- [docs/outcome-detection.md](../outcome-detection.md) — user guide
- [docs/success-criteria.md](../success-criteria.md) — the control-loop sibling
- ADR-0002 — SQLite via the `node:sqlite` built-in (schema-in-`ensureSchema` convention)
- ADR-0016 — LlmSpawner abstraction
- ADR-0018 — Three-layer secret redaction (applies to `inputsJson` only; see Negative above)
