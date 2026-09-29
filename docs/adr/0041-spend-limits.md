# ADR-0041: Spend limits per run and per agent per day, enforced where the money is spent

- Status: accepted
- Date: 2026-09-28
- Deciders: Greg Meyer

## Context

ADR-0040 made cost visible. The owner asked for limits that **stop** spending (not just warn),
in USD at list price, with an inbox item when one is hit. Goal agents loop, agents call agents,
and the provider waterfall retries on another provider, so a single run can run away, and a
scheduled agent can do it every few minutes.

A limit can only be enforced where the spending happens, and providers differ: the claude CLI
has `--max-budget-usd` (checked after each turn: a $0.01 cap still spent $0.16, because the
first turn alone cost that); an OpenAI-compatible tool loop is sua's own code; codex offers no
control mid-run.

## Decision

- **Two limits**: `perRunUsd` (the run, including agents it called) and `perDayUsd` (all of one
  agent's runs since local midnight). Per agent in YAML (`spendLimit:`), with defaults in
  `llm-settings.json` (`spendLimits`, Settings → Usage). The agent's value wins field by field.
- **Per day, at the start:** a run that starts over its agent's daily limit fails before any node
  runs, in `executeAgentDag`, so every trigger (dashboard, schedule, MCP, chat, agent-as-tool,
  Temporal worker) is covered by one check. It fires the run-failure hook, so the dashboard raises
  its usual per-agent, coalesced inbox item.
- **Per run, as it goes:** before each node the executor compares the run's spend so far (nodes +
  finished child runs) with the limit; over it, the node fails `budget_exhausted` and the rest are
  skipped. Under it, the node gets what's left (`spendBudgetUsd`), which the waterfall splits
  across attempts: claude runs with `--max-budget-usd`, the OpenAI tool loop stops before another
  model call, and codex is checked after it returns.
- **`budget_exhausted` never falls back and is never retried**, whatever the agent's retry policy:
  both would spend past the limit.
- **Only priced usage counts.** Unpriced providers are named in the UI rather than guessed at.

## Alternatives rejected

- **Warn only.** The owner chose hard stops; warnings don't stop a runaway loop at 3 a.m.
- **Refusing daily-limited runs before creating a run row.** Every entry point would need its
  own check, and a refused scheduled run would leave no trace. A failed run with a clear reason
  is visible and auditable.
- **A global (all agents) daily cap.** Useful, but per-agent defaults cover the runaway case;
  can be added on the same settings object later.
- **Pre-estimating a node's cost** to refuse it up front. Token counts aren't known until the
  model answers; the post-turn check is what providers support.

## Consequences

- Limits are soft by up to one model turn. The docs and the UI say so.
- A scheduled agent over its daily limit keeps producing refused (failed) runs until midnight;
  they cost nothing and fold into one inbox thread.
- Child runs are limited by their own agent's limits while they run; the parent's per-run limit
  counts them once they finish.
