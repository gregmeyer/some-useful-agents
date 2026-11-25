# Cost and usage

sua records what every LLM call used and cost. Use it to see which agents are expensive, and, next, to put limits on them.

## What is recorded

For each node that calls a model, and each provider attempt within it (a fallback's failed attempt still used tokens):

- tokens: input, cached input (read), cache writes, output;
- cost in **USD at list price**;
- the provider and model;
- where the cost came from:

| Source | When |
|---|---|
| `reported` | The provider says what it cost. Claude does (`total_cost_usd`). |
| `estimated` | The provider reports tokens only (codex, OpenAI-compatible endpoints) and you set a price for it. |
| `free` | Apple Foundation Models, and OpenAI-compatible endpoints on this machine (`localhost`/`127.0.0.1`) that you haven't priced. |
| `unpriced` | Tokens only, no price. The cost shows as a lower bound (`≥ $0.12`) until you set one. |

"List price" is what the same usage costs on the provider's API. On a subscription (Claude Max, ChatGPT Plus) that isn't your bill, but it is a consistent number to compare agents by and to budget against.

A run's cost is its nodes plus the runs of any agents it called as tools. It is written when the run ends. So when you add up runs yourself, count only runs with no parent (`parent_run_id IS NULL`): a child run's cost is already in its parent's. Settings → Usage counts this way.

## Where to see it

- **Run page:** cost and tokens in the header; a cost chip on each llm node (hover for every provider attempt).
- **Runs lists:** a Cost column.
- **Agent overview:** "Spend, 7 days".
- **Settings → Usage:** the last 1, 7 or 30 days by agent and by provider/model. Agent totals count top-level runs only, so an agent called by another isn't counted twice.
- **Terminal:** `sua usage [--days 30] [--agent <id>]`.

## Prices

**Settings → LLM → Pricing** lists codex and each custom endpoint. Enter input and output prices in USD per million tokens, plus an optional price for cached input (it defaults to the input price). To price one model differently, add a `provider/model` entry (e.g. `codex/gpt-5.5`); it wins over the provider-wide price. Prices apply to runs from then on; past runs keep the cost they were recorded with.

They are stored in `data/.sua/llm-settings.json` under `pricing`:

```json
"pricing": {
  "codex": { "inputPerMTok": 1.25, "outputPerMTok": 10, "cacheReadPerMTok": 0.125 },
  "codex/gpt-5.5": { "inputPerMTok": 2, "outputPerMTok": 16 }
}
```

sua ships no prices of its own: they change, and a wrong built-in price would be worse than an honest "no price".

## Limits

Three limits, in USD at list price:

- **Per run.** A run stops once it has spent this much, including the agents it called. sua checks before each node, and inside a node: claude gets `--max-budget-usd` for what's left, and an OpenAI-compatible model's tool loop stops before calling the model again. The node that hits it fails as `budget_exhausted`, the rest are skipped, and the run fails. A provider only notices after a model turn, so **a run can end up about one turn over its limit** (a single claude turn can cost $0.15–0.20 on its own).
- **Per question.** What one asked question's steps may spend (default **$8**). Once its steps have spent that, sua starts no new try and doesn't start its next step by itself: "This question has spent $8.40 of its $8.00 budget, so I stopped before Check them. Press Next step to go on." A write-up still runs, because it's the answer. It counts the runs of the notebook's steps since the question began (you asked it, or pressed a step), each once with what it called. A try already running finishes, so a question can end a try over. See [notebooks.md](notebooks.md#steps).
- **Per agent, per day.** Once an agent's runs today (local time, from midnight) reach this, its new runs fail straight away, before any node runs, whatever started them: Run now, the schedule, MCP, a chat message, another agent calling it. One inbox item per agent says so (later refusals add a note to it).

A run stopped by a limit is never retried or handed to the next provider: either would only spend more.

There's also a separate **daily cap on fallbacks**: money spent only because an earlier provider failed, such as a paid provider answering while your first one is out of quota. It's off by default; see [llm-providers.md](llm-providers.md#a-daily-cap-on-fallback-spend).

Set them:

- **Defaults for every agent, and per question:** **Settings → Usage → Spend limits**. Stored in `data/.sua/llm-settings.json` as `spendLimits: { perRunUsd, perDayUsd, perQuestionUsd }`.
- **One agent:** in its YAML, which wins field by field over the defaults:

  ```yaml
  spendLimit:
    perRunUsd: 0.50
    perDayUsd: 5
  ```

The agent's Overview shows the limits in force, where each comes from, and what it has spent today.

**Only priced usage counts.** Runs on a provider with no price (codex, or a remote OpenAI-compatible endpoint, until you set one in Settings → LLM → Pricing) don't count toward a limit; Settings → Usage and the agent's Overview name those providers.

Design notes: [ADR-0040](adr/0040-record-llm-cost-at-list-price.md) (recording), [ADR-0041](adr/0041-spend-limits.md) (limits).

## What a question costs

An asked question runs sua's own agents: triage, the drafter, the finder (and a `notebook-find-one` per search), the checker (and a `research-one` per option it checks), the writer, plus a page, tags and pictures. Four things keep that down:

- **The finder is sized to what's still needed:** about one search per two options wanted, 2 to 5 searches. A top-up of 2 makes 2 searches, not 5.
- **Check and source steps work the best few:** your pick plus 2, at least 5, unless you set **Check the top N** yourself. Checking twelve to pick one paid to check seven that wouldn't be picked.
- **Worker nodes run on Claude's mid tier:** the finder's searches, the checker's page look, research-one, the page, tags and pictures pin `model: sonnet`. The finder's plan, the checker's judge, the drafter and the writer keep your default model. A pinned Claude short name only applies on Claude; codex and OpenAI-compatible providers run the node on their own model (ADR-0104).
- **Pictures and the first page redraw wait:** pictures start once the steps stop, and the page isn't drawn again after the first step when a write-up will draw it anyway.
