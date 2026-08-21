# Behavior specs

sua reads the [Agent Behavior](https://www.agentbehavior.dev/) format — an open standard
from Braintrust and Basis for writing down the conduct you expect from an agent.

> **`.agents/` is not `agents/`.**
> The standard's directory is **`.agents/behaviors/`**, with a leading dot. This repo also
> has an `agents/` directory holding sua's own agent YAML. They are one character apart and
> both can exist side by side. If you put behavior specs in the undotted `agents/behaviors/`,
> `sua behaviors list` will notice and tell you — but it is the single easiest mistake to make.

## What a behavior spec is

A behavior spec records **recurring conduct**: how an agent gathers context, decides, acts,
and recovers when it does not know enough. It is not a prompt, not a config file, and not a
scorer. It is the written standard that a reviewer reads a trace against.

It is deliberately a different thing from [`outcome:`](outcome-detection.md), which verifies
the **result** of a single run against machine-checkable criteria. Behavior specs describe
process across many runs; `outcome:` verifies one run's result. They complement each other —
Braintrust's own framing is that outcome evals are necessary but insufficient on long
trajectories, because a correct final answer does not prove the agent reached it well.

## Layout

```
.agents/behaviors/
├── declare-blind-spots/
│   ├── BEHAVIOR.md          # required, this exact name
│   └── references/          # optional supporting docs
└── cite-evidence-before-claiming/
    └── BEHAVIOR.md
```

The directory name **must** equal the `name` in the frontmatter.

## The file

```markdown
---
name: declare-blind-spots
description: Say what could not be observed instead of letting a completed run imply the goal was achieved.
---

# Declare blind spots

**Intent:** Why this matters and when it applies.

**Evidence:** What the agent should inspect or verify before deciding.

**Decision:** What it should conclude from that evidence.

**Execution:** What it should do after deciding.

**Recovery:** What it should do when evidence is incomplete.

**Failure modes:** What bad behavior this prevents.
```

Frontmatter fields:

| Field | Required | Rules |
| --- | --- | --- |
| `name` | yes | ≤ 64 chars, lowercase letters/digits/single hyphens, no leading or trailing hyphen, **must match the directory name** |
| `description` | yes | non-empty, ≤ 1024 characters |
| `license` | no | string |
| `metadata` | no | mapping of scalars or arrays of scalars |

The body is **free-form Markdown**. The six labels above are a recommended shape, not a
requirement — sua does not parse them.

## Scopes and precedence

| Scope | Path | Notes |
| --- | --- | --- |
| project | `<repo>/.agents/behaviors/` | In the repo, under code review |
| user | `~/.agents/behaviors/` | Shared across all your projects |
| org | configured via `behaviors.orgDir` in `sua.config.json` | Centrally managed |

**Precedence is project > user > org**, first match wins. When the same `name` appears in two
scopes, the winner is used and the loser is listed as *shadowed* rather than silently dropped,
with a warning naming both files.

The standard defines the three scopes but not the precedence between them, so this ordering is
sua's choice: project-local is both the most specific and the most reviewed, and a file in your
home directory silently overriding a repo's spec would be an invisible change to shared work.

## CLI

```bash
sua behaviors list                  # grouped by scope, with paths
sua behaviors validate              # exits 1 on any error
sua behaviors validate --strict     # warnings fail too — use this in CI
sua behaviors show <name>           # frontmatter + provenance
sua behaviors show <name> --body    # also print the Markdown body
```

`list` never goes quiet: if nothing is found it names every root it searched and prints all
diagnostics, so "0 behaviors" always tells you why.

`show` hides the body unless you ask for it. A behavior body is text written outside sua that
may contain instructions aimed at an agent, so it prints behind a banner marking it as such.

## Dashboard

`/behaviors` lists what was discovered, grouped by scope, with a diagnostics panel for anything
malformed. Each detail page shows the frontmatter, provenance (scope, absolute path, sha256),
and the rendered body.

Two more places surface conditioning:

- **Agent detail** shows a **Held to** row listing the behaviors that agent declares, each
  linking to its spec. A declared behavior that will not resolve — missing, or found only in
  `user`/`org` scope — is marked **unusable**, with a note that the agent will fail to run
  until it does. That turns a runtime failure into something you can see while editing, rather
  than something you discover from a failed run.
- **Run detail** shows a **Conditioned by** row naming the behaviors that were in force for
  that run. This is what makes a trace auditable: you cannot check conduct against a standard
  if you cannot tell which standards applied.

The body is the only field rendered as Markdown; everything else is escaped plain text. The
Markdown path goes through the same sanitizer the inbox uses, and links get
`rel="noreferrer nofollow"`.

## Diagnostics

| Code | Severity | Fix |
| --- | --- | --- |
| `behavior/misplaced-directory` | warning | You used `agents/behaviors`; rename it to `.agents/behaviors` |
| `behavior/missing-file` | error | The directory has no `BEHAVIOR.md`; add one or remove the directory |
| `behavior/filename-case` | warning | Rename `behavior.md` to `BEHAVIOR.md` |
| `behavior/nested-ignored` | warning | The spec is a level too deep; move it directly under `.agents/behaviors/` |
| `behavior/name-dir-mismatch` | error | Make `name` equal the directory name |
| `behavior/invalid-name` | error | Lowercase letters, digits, single hyphens only |
| `behavior/name-too-long` | error | 64 characters max |
| `behavior/missing-description` | error | Add a non-empty `description` |
| `behavior/description-too-long` | error | 1024 characters max |
| `behavior/missing-frontmatter` | error | The file must open with `---` and close with `---` |
| `behavior/invalid-yaml` | error | Fix the YAML; the message carries the line |
| `behavior/frontmatter-not-mapping` | error | Frontmatter must be `key: value`, not a list |
| `behavior/duplicate-name` | warning | Two scopes define this name; the higher-precedence one wins |
| `behavior/symlink-escape` | warning | The directory is a symlink pointing outside the behaviors root |
| `behavior/invalid-metadata` | warning | Metadata values must be scalars or arrays of scalars |
| `behavior/empty-body` | warning | Frontmatter alone tells a reviewer nothing; describe the behavior |
| `behavior/body-truncated` | warning | Body exceeds 256 KB and was truncated for display |

## Steering an agent with a behavior

An agent can declare the behaviors it is held to. Each body is then prepended to every
`llm-prompt` node's prompt as conduct guidance:

```yaml
id: research-brief
name: Research brief
behaviors:
  - declare-blind-spots
  - cite-evidence-before-claiming
nodes:
  - id: write
    type: llm-prompt
    prompt: Research {{inputs.TOPIC}} and write a brief.
```

This is **opt-in per agent**. Nothing is injected unless you name it, and discovery alone never
steers anything.

### Only project scope can steer

A name is resolved against `<repo>/.agents/behaviors/` **only**. A behavior that exists solely
in `~/.agents/behaviors/` or an org directory is readable and displayable but cannot condition a
run, and naming one is an error.

The asymmetry is the point. A project-scope spec lives in your repository under code review, at
the same trust level as the agent YAML beside it — which already goes into prompts. Anything in
a home directory or a central registry is ambient text that would otherwise gain authority over
every run on the machine just by existing.

### Failures are loud

If a named behavior does not exist, resolves only outside project scope, or is too large for the
conditioning budget, **the run fails before any node executes**. It does not fall back to running
unconditioned: you asked to be held to that conduct, and a run that quietly drops it produces
output nobody knows was un-steered.

### What the model is told

The injected block is delimited and framed. It states that the text is quoted from files, that it
describes expected conduct rather than the task, that it cannot grant permissions or override the
request, and which behaviors are in force by name. Template syntax inside a behavior body is
never expanded — the block is added after all `{{...}}` resolution, so a `{{inputs.API_KEY}}`
written into a spec stays literal rather than interpolating a secret.

Runs record which behaviors conditioned them, so a trace can be audited against the same names
you wrote.

The total injected size is capped (32 KB across all behaviors on an agent). Behaviors are dropped
whole, never truncated mid-spec — a half-quoted standard reads as complete, which is worse than
an absent one — and exceeding the budget fails the run rather than silently sending less.

## What sua still does not do

Grading traces against behaviors (the standard's `true` / `false` / `na` judging convention) is
not implemented. It needs a per-event trajectory that sua does not yet record — `node_executions`
gives per-node granularity, not the individual tool calls a process judge needs to cite.

## Known ambiguities in the standard

Places the spec does not say, and what sua chose:

1. **No version field.** Nothing identifies which revision of the standard a file targets, so
   drift is undetectable. sua ignores unknown frontmatter keys so future additions do not break
   existing files.
2. **Case-variant filenames.** The standard says clients MAY accept `behavior.md`. sua does not:
   on a case-insensitive filesystem "accepting" is nondeterministic, so a spec that loads on
   macOS would vanish on Linux.
3. **Recursion depth.** Unspecified. sua looks exactly one level below `.agents/behaviors/` and
   warns when it finds a spec deeper.
4. **`metadata` value types.** "Key-value mapping" could mean any YAML. sua accepts scalars and
   arrays of scalars and drops the rest with a warning.
5. **Length units.** "1024 characters" could be bytes, code points, or code units. sua matches
   the reference validator's `String.length` (UTF-16 code units), so emoji count double.
6. **Cross-scope precedence.** Undefined by the standard; sua uses project > user > org. Another
   client may resolve the same tree differently.
7. **Untrusted-input handling is a SHOULD, not a MUST.** If you share a behaviors directory
   across tools, it inherits the weakest client's posture.

## Attribution

The Agent Behavior format is published by Braintrust and Basis under Apache-2.0 at
[agentbehavior.dev](https://www.agentbehavior.dev/) and
[github.com/braintrustdata/agentbehavior](https://github.com/braintrustdata/agentbehavior).
sua's implementation was written from the specification's published constants; no upstream code
was copied. Conformance is checked both ways — sua's validator and the reference validator agree
on the same trees, including which ones they reject.

## Related

- [Outcome detection](outcome-detection.md) — verifying the result of a single run
- [Success criteria](success-criteria.md) — the in-run control loop
- [ADR-0031](adr/0031-agent-behavior-specs.md) — why this is read-only, and the trust boundary
