# ADR-0040: Record every LLM call's tokens and cost, in USD at list price

- Status: accepted
- Date: 2026-09-28
- Deciders: Greg Meyer

## Context

sua had no idea what a run cost. Goal agents loop until done, agents call agents, and the
provider waterfall retries on another provider, so one run can spend a lot, and nothing showed
it. Budgets (the next step) need a number to enforce.

Providers report different things: claude's stream-json `result` has `total_cost_usd` (list
price, even on a subscription) plus token counts; codex reports tokens per turn and no model or
cost; OpenAI-compatible endpoints report `usage` tokens per response; Apple Foundation Models
reports nothing and is free.

## Decision

- **Unit: USD at list price**, with tokens alongside. A token count alone can't compare an Opus
  run with a local Qwen run.
- **Captured where the call happens.** Each attempt in the provider waterfall reports its usage
  (a spawner's `extractUsage`, the OpenAI tool loop's summed `usage`), including failed
  attempts, and is priced there with the operator's price table. The node records the total and
  every attempt; the cost is fixed at the time of the run, so a later price change doesn't
  rewrite history.
- **Cost source per attempt:** `reported` (the provider said), `estimated` (tokens × a price
  from `LlmSettings.pricing`, keyed `provider/model` then `provider`), `free` (Apple FM, or a
  loopback endpoint with no price), `unpriced` (tokens, no price → totals shown as a lower
  bound).
- **No built-in prices.** Prices change and differ by account; a stale default would be silently
  wrong. Token-only providers show "no price" until the operator sets one.
- **Run totals include child runs** (agents called as tools) and are written when the run ends
  (`RunStore.updateRun` with `completedAt` → `rollupRunUsage`), whichever path ends it. Summaries
  by agent count top-level runs only; by provider count node attempts.
- Travels with `SpawnResult`, so Temporal workers behave the same.

## Alternatives rejected

- **Tokens only.** No prices to maintain, but budgets in tokens are meaningless across models.
- **Price at display time.** History would change whenever a price changed, and budgets need the
  cost while the run is going.
- **Only the winning attempt.** Fallbacks after a long failed attempt would under-report.

## Consequences

- Codex and remote OpenAI-compatible costs are only as good as the prices entered.
- Runs from before this change have no cost (nothing to backfill from).
- Budgets can now be enforced in USD; unpriced providers can't be, and the UI must say so.
