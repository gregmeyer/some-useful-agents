---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Author-declared agent outputs.

New top-level `outputs:` field on agents — a typed map describing the shape the agent's final-node JSON result reliably contains. Mirrors `inputs:` but with `lowercase_snake_case` names (matches JSON convention) and types `string | number | boolean | object | array`. Optional but recommended.

```yaml
outputs:
  articles:
    type: array
    description: List of stories with title, url, score
  count:
    type: number
```

Documentation, not a runtime contract — the executor doesn't verify the JSON matches. Used by the planner-fronted agent-builder (PR A) for cross-agent composition via `agent-invoke`, and by the Output Widget editor for `name:` field suggestions. Three example agents (`llm-tells-a-joke`, `daily-joke`, `two-step-digest`) now declare `outputs:` as reference patterns.
