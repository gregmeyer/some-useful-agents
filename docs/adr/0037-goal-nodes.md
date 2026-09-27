# ADR-0037: Goal nodes run as framed llm-prompt nodes, finished by `<final>`

- Status: accepted
- Date: 2026-09-27
- Deciders: Greg Meyer

## Context

Every sua agent was a flow of steps written in advance. Build-from-goal had to predict
the whole flow for an open-ended ask, and 10 of 61 builds were kept. The roadmap's answer
was "outcome-driven flows", a runtime planner that generates a flow, runs it, judges it
and re-plans.

Phase A made a node's tools work the same on every provider (claude via a per-attempt MCP
endpoint, OpenAI-compatible models via sua's tool loop), recorded every call, and put one
policy check in front of all of them. An `llm-prompt` node with `tools:` and `maxTurns` is
therefore already a tool-using loop on any capable provider.

## Decision

Add `type: goal`, a node with `goal`, `tools` (at least one) and `budget`
(`maxTurns` default 15, `timeoutSec` default 600). It is not a new engine:

- **Framed, then run as llm-prompt.** Just before spawning, the executor converts it
  (`toGoalPromptNode`) into an llm-prompt node: a prompt that states the goal, the tools,
  the budget, how to work, and how to finish, with the budget as `maxTurns` / `timeout`.
  Every backend, including a Temporal worker, sees an ordinary llm node. The provider
  fallback chain, the tool surface, policy and trace all apply unchanged.
- **An explicit done signal.** The model must end with `<final>…</final>`. The step's
  result is that block, as a JSON object with the agent's declared `outputs:` fields when
  there are any. Output without `<final>` means the loop was cut off (turns, time, or the
  model stopped), and becomes the `budget_exhausted` failure. It is not fallback-worthy,
  since another provider has the same budget, and it is not retried by default.
- **A step, not an agent kind.** Goal steps compose with flows (`dependsOn`, templates,
  `onlyIf`), so a flow can hand an open-ended sub-task to a goal step.

This replaces the outcome-driven-flows planner: an agent loop with tools plus
`<final>` / outputs covers "declare what you want, let it find the steps" without
generating and re-planning DAGs.

## Consequences

- A goal agent is one short YAML node, which is a much easier target for build-from-goal
  than a whole flow (next PR).
- Nothing is spent beyond `maxTurns` / `timeoutSec`. Cost budgets need token/cost capture,
  which no provider path records yet; deferred.
- Agents as tools (`agent:<id>`), so a goal step can delegate, is the next PR.
- The dashboard node form doesn't edit goal nodes yet. It redirects to YAML rather than
  rewriting them as shell nodes.

## Alternatives considered

- **An agent-level `kind: loop`.** Rejected: `loop` already names a node type, and a
  node composes with flows while an agent kind can't.
- **A new executor for the loop.** Rejected: it would duplicate the provider chain,
  tool surface, policy, trace and Temporal wiring that llm-prompt already has.
- **Trust the last message as the answer.** Rejected: an answer cut off by the turn
  limit would be passed downstream as if it were finished.
