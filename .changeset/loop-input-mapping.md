---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

`loopConfig.inputMapping` — pass per-iteration values to looped sub-agents.

The build-planner v3 catalog teaches the `loop + agent-invoke` recipe with
`inputMapping: { COMPANY_SLUG: "$item.slug", JOB_QUERY: "{{inputs.JOB_QUERY}}" }`,
but the loop executor previously only set `ITEM` / `ITEM_INDEX` on each sub-run —
so sub-agents fell through to their default inputs every iteration and the
composition pattern never actually worked.

This adds the schema field and resolves three source forms inside the loop:

- `$item.<path>` — walk into the current iteration's item
- `$upstream.<id>.<field>` — pull from any upstream node's structured output
- `{{inputs.X}}` — forward the parent agent's input X down to each sub-run

Anything else is treated as a literal. When `inputMapping` is unset, behaviour
is unchanged (sub-agent still gets `{ITEM, ITEM_INDEX}`).
