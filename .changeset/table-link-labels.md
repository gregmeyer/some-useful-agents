---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Table links show a name instead of the raw address.

A link column in a view or widget shows the row field its `linkText` names (e.g. the agent's name), or a cell's own `{label, url}`. Without either, a dashboard path shows its last part (`ashby-jobs-multi`, `run ab12cd34`) and a web address shows without `https://` or `www.`, shortened when long, with the full address on hover. Starter views and sua's guides use `linkText`, and link text wraps like words instead of mid-word.
