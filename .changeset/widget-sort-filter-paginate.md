---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Three new output-widget controls: `sort`, `filter`, `paginate`. They operate on top-level arrays in the agent's JSON output (e.g. `outputs.rows`, `outputs.daily`) and slot into the existing URL-driven control system — no client JS, full SSR.

```yaml
outputWidget:
  type: ai-template
  template: <table>{{#each outputs.daily as d}}<tr>…</tr>{{/each}}</table>
  controls:
    - type: filter
      field: daily
      columns: [date, top_model]
    - type: sort
      field: daily
      columns: [date, cost, tokens]
      default: date desc
    - type: paginate
      field: daily
      pageSize: 10
```

URL grammar:
- `?ws=<column>-<asc|desc>` — sort
- `?wf=<query>` — case-insensitive substring filter across the listed columns
- `?wp=<n>` — 1-based page index

Order applied per field: filter → sort → paginate. Changing sort or filter resets the page to 1; pagination preserves the active filter + sort. Empty arrays / non-array fields no-op gracefully. Stable sort, nulls last, numeric vs string sort inferred from the data.

Only takes effect on `ai-template` widgets today — the typed widget renderers (`dashboard`, `key-value`, `raw`, `diff-apply`) don't surface array data yet. Coming next: a first-class `table` field type on `dashboard` widgets.
