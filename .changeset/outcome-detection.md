---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Outcome detection: evidence-backed records of what resulted from a run.

sua could tell you an agent finished. It could not tell you what happened because the
agent ran. Add an `outcome:` block to any agent — what you expect, what counts as
evidence, and optionally what success means — and after each run sua produces a
structured `OutcomeRecord`: expected vs. observed, the evidence behind it with resolvable
provenance pointers, a confidence level, and an explicit list of what could not be
determined.

Detection is a post-run observer, wired with one dep (`onRunComplete:
outcomeDetectionHook({ outcomeStore })`) and opt-in per agent, so registering it globally
costs nothing for agents that declare no expectation. `outcome.success` reuses the
existing `successCriteria` grammar and evaluator.

An optional LLM judge fills in "what happened, in words". It sees only the evidence
bundle, must cite evidence ids, and any claim citing evidence that does not exist is
dropped rather than accepted — grounding is enforced by the code, not requested in the
prompt. Deterministic criteria always beat the judge, and disagreements are recorded.
The judge is off by default.

Inspect records with `sua outcome list --unsatisfied` and `sua outcome show <runId>`.

Also fixes a pre-existing bug this uncovered: `successCriteria` and `maxLoopIterations`
were dropped by `parsedToAgent` / `extractDag` / `mergeRowWithVersion`, so they validated
in YAML and then vanished before reaching the store — the agent eval loop had never
actually engaged in production. Criterion and evidence-selector node ids are now
validated at import instead of failing silently at eval time.

See docs/outcome-detection.md and docs/adr/0030-outcome-detection.md.
