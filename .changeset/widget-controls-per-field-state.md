---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Per-field state for the `sort` / `filter` / `paginate` widget controls (PR #279 follow-up).

**URL grammar changed**:
- `?ws=<col>-<dir>` → `?ws_<field>=<col>-<dir>`
- `?wf=<query>` → `?wf_<field>=<query>`
- `?wp=<n>` → `?wp_<field>=<n>`

Previously the global params applied to every control whose column list matched the named column. A widget with two `sort` controls on different arrays (e.g. `daily` + `models`, both with a `tokens` column) couldn't be sorted independently — `?ws=tokens-asc` re-shaped both. URL params now scope to the control's `field`, so each table keeps its own state.

Also tightens the numeric-sort detector to handle common display formatting:
- Currency prefixes (`$`, `€`, `£`, `¥`) — `"$711.63"` now sorts as `711.63`
- Percent suffix (`%`) — `"95%"` sorts as `95`
- Thousands commas (`"$1,234.56"`) — sorts as `1234.56`

SI suffixes (`K`/`M`/`B`) are still treated as strings — those need magnitude logic that's a separate design call. Agents that want SI-formatted display + numeric sort should surface a parallel `<col>_raw` numeric column.

**Breaking**: callers that hand-built `WidgetControlState` with scalar `sort` / `filter` / `page` fields must switch to `ReadonlyMap<field, …>`. Only the two dashboard route handlers and the test suite have this shape internally; agent YAML / outputWidget schemas are unaffected.
