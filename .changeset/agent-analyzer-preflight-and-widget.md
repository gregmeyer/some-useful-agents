---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

agent-analyzer: friendlier missing-AGENT_YAML error + outputWidget + signal.

The analyzer used to fail at setup time with an opaque generic
"missing required input" error whenever it was invoked without the
dashboard's automatic YAML injection (manual run, scheduled trigger,
programmatic call). The input is now `required: false` with an empty
default, and a new `preflight` shell node runs first to validate it.
On empty input the operator sees a one-shot human-readable message
naming the three ways to supply the YAML — not a stack trace.

Also adds the missing `outputWidget` (key-value with classification,
summary, has_suggested_yaml, source_node) and `signal` (text-headline
for Pulse), driven by a new trailing `summarize` shell node that
emits a JSON envelope extracted from the analyze (or fix) output.

Regression test in `agent-yaml.test.ts` locks in the preflight-first
ordering + widget+signal declaration.
