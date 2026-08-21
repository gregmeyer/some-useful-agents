# ADR-0031: Adopt the Agent Behavior spec, with scope as the trust boundary

- Status: Accepted
- Date: 2026-08-21
- Supersedes: none
- Related: [ADR-0030](0030-outcome-detection.md) (outcome detection), [ADR-0021](0021-html-allowlist-sanitizer.md) (HTML sanitizer)

## Context

Braintrust and Basis published [Agent Behavior](https://www.agentbehavior.dev/), an
Apache-2.0 standard for describing the conduct an agent is expected to follow across
repeated interactions. A spec is `.agents/behaviors/<name>/BEHAVIOR.md`: YAML frontmatter
with `name` and `description`, then free-form Markdown.

The question that started this was whether sua's `outcome:` block complies with it. **It
does not, and it should not** — they are different artifacts at different layers:

| | Agent Behavior | sua `outcome:` |
| --- | --- | --- |
| Unit | Recurring conduct across many interactions | One run's result |
| What is judged | Attempts / process | Result |
| Machine-checkable assertions | None, by design | `success[]`, four deterministic criterion kinds |
| Verdicts | `true` / `false` / `na` | `yes` / `no` / `partial` / `undetermined` |

Braintrust's own framing is complementary rather than competing: outcome evals matter, but
on long trajectories they are expensive and the outcome is often hard to verify, and a
correct final answer does not show the agent reached it well. Their judge prompt says it
outright — *"Judge attempts, not outcomes."*

Worth recording: our outcome detector had already converged on the standard's hardest
ideas independently — citation-grounded judging, a first-class "cannot tell" verdict,
treating spec and trace as untrusted, and folding verdicts deterministically rather than
letting the model decide. That convergence is why adopting the standard alongside
`outcome:` is low-risk.

## Decision

**Implement the client side of the standard natively in `@some-useful-agents/core`:
discover, validate, and display behavior specs. Do not change `outcome:`.**

The upstream `agentbehavior` package is not published to npm, so we implement from its
published constants rather than depending on it. `BehaviorDiagnostic` mirrors the reference
validator's `Diagnostic` field-for-field, and `BehaviorRecord` is a strict superset of
theirs — a superset stays conformant, a rename would not.

**Scope is the trust boundary.** This is the load-bearing decision:

| Scope | Origin | Trust |
| --- | --- | --- |
| `project` | `<repo>/.agents/behaviors/` | In the repo, under code review — the same trust level as the agent YAML beside it |
| `user` | `~/.agents/behaviors/` | Any file in a home directory, applying to every project on the machine |
| `org` | A configured central directory | Not reviewed by this repo |

Anything that could give a behavior spec authority over a run is restricted to `project`
scope. `user` and `org` specs are readable and displayable, never authoritative. A spec
under code review is ordinary repo content; a spec in a home directory is ambient text that
must not acquire power by merely existing.

**Reader first, conditioning second.** The initial change shipped discovery, validation, a
CLI verb, and a dashboard page, with no prompt injection at all — the standard says clients
SHOULD NOT inject specs into runtime prompts "unless intentionally building a
behavior-conditioned agent", and that intent deserved its own change rather than arriving as
a side effect of adding a reader.

**Amendment (2026-08-21): opt-in conditioning.** An agent may now declare `behaviors: [name]`,
and each named body is prepended to its `llm-prompt` nodes. This is the "intentionally
behavior-conditioned agent" the standard contemplates, and it is bounded on four sides:

1. **Opt-in per agent.** Discovery never steers anything; only a declared name does.
2. **Project scope only**, per the trust table above. A name resolving solely to `user` or
   `org` scope is an error, not a fallback.
3. **Loud failure.** An unresolvable name, a wrong-scope name, or an over-budget body fails
   the run *before any node executes*. Falling back to an unconditioned run would produce
   output nobody knows was un-steered — undetectable after the fact, unlike a startup error.
4. **Positional inertness.** The block is prepended AFTER every template resolver, so
   `{{inputs.X}}` inside a behavior body stays literal instead of interpolating a secret.
   This is a property of *where* the prepend sits in `node-spawner.ts`, so a test asserts the
   ordering in the source — a refactor that moves it up would otherwise turn behavior files
   into a template-injection primitive with nothing to notice.

Conditioning lives in its own module (`behavior-conditioning/`) importing the reader, never
the reverse, so `behaviors/` stays provably inert and its isolation test keeps passing.

## Rejected alternatives

**Vendor the upstream Apache-2.0 source.** A hand-tracked fork with license headers to
maintain, for ~200 lines of pure-function validation whose normative constants are
published. Rejected.

**Extend `agents/*.yaml` with a `behavior:` block instead of adopting `.agents/behaviors/`.**
This destroys the only thing a cross-tool standard is for: specs authored for another tool
would be unreadable by sua and vice versa. Rejected.

**Auto-inject every discovered spec into agent prompts.** Contrary to the standard's
guidance, and it turns any file dropped into `~/.agents/behaviors/` into a prompt-injection
vector with ambient authority over every run on the machine. Rejected: conditioning is
opt-in and project-scope-only (see the amendment above).

**Inject a one-line summary instead of the body.** Closest to the standard's "concise
summaries" wording and far cheaper in tokens, but a description cannot change conduct — the
Intent/Evidence/Decision/Execution/Recovery structure *is* the steering content. Rejected;
we inject full bodies of explicitly opted-in specs, which is a bounded set, not the corpus
the guidance warns about.

**Let conditioning fall back to running unconditioned when a name does not resolve.** More
forgiving of a typo or a deleted spec, but it produces a normal-looking run that silently
lacked its standards. Rejected in favor of failing before the first node.

**Extend `loadAgents()` to also return behaviors.** Different file format, different scopes,
different precedence. And that loader's silent-skip bug (see below) is a reason to keep new
code out of it, not to add more. Rejected.

**Accept case-variant filenames**, which the standard permits (MAY). On a case-insensitive
filesystem "accepting" is nondeterministic: a spec that loads on macOS vanishes on Linux.
We refuse them with a warning that names the fix. Rejected for portability.

**Treat a directory with no `BEHAVIOR.md` as a warning.** The standard does not specify a
severity, but the reference implementation fails on it. Disagreeing would mean the two
validators return different exit codes for the same tree — the exact interop failure this
work exists to avoid. We match upstream and make it an error.

**Build the trace judge now.** The standard carries no scorer implementation details by
design, and grading needs a per-event trajectory we do not record. Deferred.

## Consequences

**Positive.** Cross-tool portability: specs written for another client are readable here and
ours are readable there, verified by running both validators over the same trees and
confirming they agree, including on rejections. The `.agents/behaviors` literal lives in one
file, so the standard moving costs one edit. Provenance is a struct rather than a path, so
"where did this come from" cannot drift from "where is this file".

**Negative.** We own conformance drift: the standard has no version field, so a breaking
change upstream is undetectable and would silently alter what our files mean. Our precedence
rule (project > user > org) is a local invention that another client may resolve differently,
so the same tree can mean two things in two tools. And `.agents/` sits one character from
this repo's own `agents/`, a confusion mitigated by a positive-detection diagnostic but not
eliminated.

## Note on silent failure

Every skip path in the loader emits a diagnostic before it skips, and a test asserts a
three-spec fixture returns exactly three records. That is not defensive habit: `agent-loader.ts`
drops every v2 agent file with a bare `continue` and no warning, which is how CI printed
`0 agent(s) validated successfully` in green for months while validating nothing at all. An
empty result that looks like success is the specific failure this module is built not to repeat.
