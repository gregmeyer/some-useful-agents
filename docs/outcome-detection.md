# Outcome detection

sua can tell you that an agent finished. That is not the same as telling you what
happened *because* it ran.

Outcome detection closes that gap. After a run, it produces an **outcome record**: a
structured, machine-readable answer to

- what did we expect?
- what actually resulted?
- what evidence supports that?
- what was inferred rather than observed?
- did it satisfy the expectation?
- how confident are we?
- what could we not determine?

It is not logging, tracing, or a metrics system. Those tell you what the agent *did*.
This is about what *resulted*.

---

## Quick start

Add an `outcome:` block to any agent. Nothing about execution changes.

```yaml
id: two-step-digest
name: Two-step digest
status: active
source: examples

outcome:
  expected: >
    A digest was produced that lists headlines read from the source file and
    ends with a count line reporting a non-zero number of headlines loaded.
  assumptions:
    - The source file is valid JSON with one "title" key per headline.
  evidence:
    - { kind: nodeStatus, nodeId: fetch, label: Did the source file read succeed? }
    - { kind: nodeResult, nodeId: summarise, label: The digest text itself }
    - { kind: nodeOutputField, nodeId: fetch, field: bytes }
    - { kind: runStatus }
  success:
    - { kind: shellExitZero, nodeId: summarise }
    - { kind: regexMatch, nodeId: summarise, pattern: "[1-9][0-9]* headlines loaded" }

nodes:
  - id: fetch
    type: shell
    tool: file-read
    toolInputs: { path: agents/examples/data/sample-headlines.json }
  - id: summarise
    type: shell
    dependsOn: [fetch]
    command: |
      echo "$UPSTREAM_FETCH_RESULT" | head -5
      echo "$(echo "$UPSTREAM_FETCH_RESULT" | grep -c '"title"') headlines loaded."
```

The dashboard, the scheduler daemon, and `sua workflow run` already have the
detector registered — adding the block above is all you need. To wire it into your
own executor call:

```ts
import { executeAgentDag, OutcomeStore, outcomeDetectionHook } from '@some-useful-agents/core';

const outcomeStore = new OutcomeStore(dbPath);

await executeAgentDag(agent, { triggeredBy: 'cli' }, {
  runStore,
  onRunComplete: outcomeDetectionHook({ outcomeStore }),
});
```

That is the whole integration. The hook is a no-op for agents that have no `outcome:`
block, so you can register it globally without opting anything in.

Read the results:

```
$ sua outcome list --unsatisfied
$ sua outcome show 5bb7352e
$ sua outcome show 5bb7352e --json
```

…or open the run in the dashboard: `/runs/:id` shows the outcome above the raw
result, because "did this achieve what it was for" is a more useful first
question than "what did it print".

---

## What consumes outcome records

Records aren't just for reading. Four things act on them:

| Consumer | What it does |
|---|---|
| **Run detail** (`/runs/:id`) | Shows the verdict, the checks, and the evidence above the raw result. |
| **Verify-on-resolve** | An inbox thread auto-resolves only when the fix actually achieved the outcome — not merely when the agent exited 0. `undetermined` holds the thread open rather than closing it. |
| **The inbox** | A run that **completed but missed its outcome** raises an `outcome` thread. This is the silent-failure class: `run-failure` never fires for it, so before this it produced no signal at all. |
| **The next run** | `OUTCOME_FEEDBACK` (see below). |

### Outcome threads in the inbox

Raised only when `run.status === 'completed'` **and** the verdict is `no` or
`partial`. Deliberately never on:

- **failed runs** — `run-failure` already owns those;
- **`undetermined`** — "we couldn't tell" is not evidence of a problem, and
  raising on it is how an inbox teaches people to ignore it.

Threads are `medium` priority (`high` stays reserved for actually-broken) and
coalesce per agent: an agent that misses nightly produces one thread with a
visible frequency, not thirty threads. Set `SUA_INBOX_OUTCOME_MISSES=0` to
disable while keeping detection and `sua outcome list`.

### Feeding the next run

When the **immediately previous** run of an agent missed its outcome, sua can
hand the next run what went wrong:

```yaml
inputs:
  OUTCOME_FEEDBACK:
    type: string
    required: false
    default: ""
```

Declaring the input is the entire opt-in — undeclared inputs are dropped by the
executor, so agents that don't want it are unaffected. The value contains the
expectation, the failed checks, and the observed evidence, formatted like
`LOOP_FEEDBACK` (its within-a-single-loop sibling). Use it via
`{{inputs.OUTCOME_FEEDBACK}}` or `$OUTCOME_FEEDBACK`.

Only the previous run is read. A miss from three weeks ago is noise, not
context, and injecting it would quietly bias every future run of an agent that
has since been fixed. A run whose outcome was `undetermined` produces no
feedback — telling an agent it failed when we couldn't tell would be exactly
the fabrication this capability exists to prevent.

**This is not learning.** Nothing modifies the agent, its prompt, or its config;
the string is context for one run and then gone. See
[ADR-0030](adr/0030-outcome-detection.md#why-learning-is-out-of-scope).

---

## The record

Four tiers, kept separate on purpose. Confusing them is the failure mode this whole
capability exists to prevent.

| Tier | When it's known | Fields |
|---|---|---|
| **declared** | before the run | `intent.expected`, `intent.assumptions`, `intent.success`, `intent.unobservable`, `execution.actor` |
| **observed** | during the run | `observation.evidence[]` |
| **inferred** | after, by an LLM | `observation.observedOutcome`, `evaluation.expectedVsObserved` |
| **evaluated** | after, by rules | `evaluation.satisfied`, `evaluation.confidence`, `evaluation.criteriaResults` |

Anything that cannot be filled becomes an explicit entry in `unknowns[]`. Nothing is
guessed to fill a gap.

### Verdicts

| `satisfied` | Meaning |
|---|---|
| `yes` | every declared criterion passed, and nothing was declared unobservable |
| `partial` | some criteria passed and some failed, or everything passed but part of the expectation is unobservable |
| `no` | every declared criterion failed |
| `undetermined` | there was nothing to check against, or nothing could be inferred |

`undetermined` is a correct answer, not a failure of the detector. A system that always
produces a verdict is not more useful — it is less trustworthy.

### Confidence

Rule-derived, never asked for:

- `high` — the verdict came from deterministic criteria
- `medium` — the verdict came from a judge whose every claim was grounded
- `low` — a claim was dropped for bad citations, or the verdict is `undetermined`

---

## Evidence

`evidence:` is a list of selectors. Each one resolves to an `EvidenceItem` carrying a
**resolvable provenance pointer** — you can go back to `node_executions` or the
filesystem and re-derive the value yourself.

| Selector | Resolves to |
|---|---|
| `{ kind: nodeResult, nodeId }` | that node's stringified output |
| `{ kind: nodeOutputField, nodeId, field }` | one field of its structured output (`outputsJson`) |
| `{ kind: nodeStatus, nodeId }` | its status, exit code, and error category |
| `{ kind: runStatus }` | the run's status and error |
| `{ kind: file, pathTemplate }` | a post-hoc filesystem probe; `{{inputs.X}}` and `{{state}}` expand |

All accept an optional `label:`.

### Absent evidence is evidence

A selector that resolves to nothing produces an item with `kind: 'absent'` whose value
explains what was looked for and not found — plus an `unknowns` entry with reason
`evidence-missing`.

```json
{
  "id": "ev2",
  "kind": "absent",
  "source": { "runId": "…", "nodeId": "summarise", "selector": "nodeResult" },
  "value": "node \"summarise\" produced no result (status: skipped)"
}
```

This is deliberate. A detector that silently drops misses can only ever report success.

### Redaction

Evidence values are passed through `redactKnownSecrets` before they are stored or shown
to a judge. This matters because the local DAG executor writes **raw** stdout to
`node_executions.result` — value scrubbing is applied on the v1 chain path and the
Temporal activity, but not there.

Redaction is prefix-based (AWS keys, GitHub PATs, `sk-` keys, Slack tokens). It will not
catch an arbitrary opaque credential your agent happens to print. Do not enable an LLM
judge on an agent whose output you would not paste into a chat window.

---

## Success criteria vs. outcome detection

sua has two things that sound similar. They are not.

|  | `successCriteria:` | `outcome:` |
|---|---|---|
| Purpose | **control** — re-run the agent when it fails | **observation** — describe what resulted |
| Effect on execution | agent re-runs up to `maxLoopIterations` | none |
| Produces | eval feedback injected into the next iteration | an `OutcomeRecord` |

`outcome.success` reuses the same criterion grammar, so there is only one thing to learn,
but declaring it does **not** opt an agent into the re-run loop. An agent can have either,
both, or neither.

---

## The LLM judge (optional, off by default)

Deterministic criteria cannot answer "what happened, in words". A judge can — under
constraints that stop it becoming "ask an LLM whether it worked":

1. It sees **only** the evidence bundle and the declared intent. Never the run, never the
   node records, never the agent definition. It cannot cite what it was not shown.
2. Every claim must carry `citedEvidenceIds`.
3. Those citations are validated against the bundle afterwards. **A claim citing evidence
   that does not exist is dropped**, `confidence` is forced to `low`, and an
   `ungrounded-claim` unknown is added.
4. It never decides `satisfied` when criteria exist. Criteria win, and the disagreement is
   recorded as `evaluation.judgeDisagreedWithCriteria` — which is how we measure whether
   the judge can be trusted where criteria don't exist.

```ts
import { llmJudge, outcomeDetectionHook } from '@some-useful-agents/core';

onRunComplete: outcomeDetectionHook({
  outcomeStore,
  judge: llmJudge({ provider: 'claude' }),
})
```

Off by default because it costs tokens and adds latency to whatever is awaiting the run —
notably a Temporal activity's start-to-close budget.

---

## Limits — read this before trusting a record

**Evidence is not world state.** Everything observable is what sua happened to persist.
An agent that posts to Slack leaves no evidence that anyone read the message. There is no
artifact abstraction in sua: evidence comes from `node_executions`, the `runs` row, and
filesystem probes. A file written outside `$STATE_DIR` is invisible unless you declare a
`file` selector for it.

**Declare your blind spots.** A detector cannot infer, from a prose expectation, which
parts of it are unobservable. Someone has to say so:

```yaml
outcome:
  expected: The morning digest reached the team and someone acted on a headline.
  unobservable:
    - whether the digest was delivered to any recipient
    - whether a recipient read it
```

Each entry becomes an `unknowns` row with reason `not-observable-post-hoc` and forces the
verdict away from `yes`. This is the single most useful field in the schema, and the one
most likely to be skipped.

**Coverage of the hook.** `onRunComplete` fires for the two statuses the executor itself
computes — `completed` and `failed`. A run finalized outside the executor (a Stop the
abort didn't land, orphan-reaper finalization) never reaches it and produces no record.

**Learning is out of scope.** `followUp[]` is advisory; nothing in sua reads it to modify
an agent, prompt, or config. See
[ADR-0030](adr/0030-outcome-detection.md#why-learning-is-out-of-scope).

---

## Detecting outcomes imperatively

When you want the record in hand rather than stored:

```ts
const run = await executeAgentDag(agent, opts, deps);

const record = await detectOutcome({
  agent,
  run,
  nodeExecutions: runStore.listNodeExecutions(run.id),  // not derivable from `run`
  expectation: { expected: '…', evidence: [...] },       // overrides the YAML block
  judge: llmJudge({ provider: 'claude' }),               // omit for a deterministic record
});
```

---

## Storage

One row per run in `outcome_records` (same SQLite file as everything else). Writes are
upserts keyed on `run_id`, so re-running the executor tail against the same run — which
`options.resume` and Temporal activity retries both do — updates the record instead of
throwing.

---

## Evaluating the detector itself

`packages/core/src/outcome/eval.test.ts` scores detection against a 12-run labelled
fixture and prints a scorecard:

```
  OutcomeDetection scorecard — deterministic, no judge
  ├─ evidence grounding ......... 100.0%  (gate: 100%)
  ├─ outcome recall ............. 100.0%  (gate: ≥90%)
  ├─ false outcome rate ......... 0.0%    (gate: 0%)
  ├─ missing-state detection .... 100.0%  (gate: ≥90%)
  ├─ evaluation accuracy ........ 100.0%  (gate: ≥90%)
  └─ overclaim rate ............. 0.0%    (reported, not gated)
```

It also runs adversarial judges — one that fabricates citations, one that says yes to
everything — to check that grounding holds because the mechanism rejects them, not
because the model behaved.

Representative records from real runs live in
`packages/core/src/outcome/fixtures/records.jsonl`. Regenerate with:

```
npm run outcome:fixture
```

---

## See also

- [ADR-0030 — Outcome detection](adr/0030-outcome-detection.md)
- [Success criteria](success-criteria.md) — the control-loop sibling
- [Agents](agents.md) — the full agent schema
