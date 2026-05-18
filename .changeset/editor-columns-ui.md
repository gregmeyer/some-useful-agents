---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Output Widget editor: edit `table` field columns inline (no more YAML-only round-trip).

Each `type: table` field now expands a sub-table with one row per column (Column key / Label / Format / Href key / Text key-or-literal / delete). The Format dropdown toggles between `text` and `link`; switching a field's type to `table` seeds an empty column row so the schema validator doesn't immediately reject. Removing a column doesn't reshuffle indices — the parser skips gaps. `href`/`text` are only saved when format=link (schema would reject them on text columns).

The previous-version preservation from #287 still kicks in when the form posts no columns for an existing table field (so non-dashboard callers — CLI/MCP/custom integrations — don't get destroyed), but form-posted columns now win whenever they're present, which is what makes the editor actually editable.

Controls (`sort` / `filter` / `paginate` / `replay`) and `actions` are still YAML-only to edit; those get their own follow-up. They're still preserved across saves per #287.
