---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

CSV integration kind with auto-generated read + count tools (PR 4.A)

First slice of PR 4 of the Settings → Integrations workstream. Replaces
the connectors-v0.17 plan's "CSV connector" with a `kind: csv`
integration backed by sua's existing tool dispatch.

How it works:

1. Add a CSV integration at `/settings/integrations?tab=csv` pointing
   at a file. On save, sua reads the header + first 200 rows, infers
   per-column types (number / boolean / date / timestamp / string),
   and stores the snapshot on the integration row.

2. Two tools are auto-generated per CSV integration:
   - `csv.<id>.read` — fetch matching rows (optional `where` filter,
     `limit` cap), returns coerced values + row count.
   - `csv.<id>.count` — count matching rows without fetching.

3. Agents reference them via the standard `tool:` field on a node.
   The executor finds them through the same lookup chain as built-in
   tools (built-in → connector-generated → user/MCP), so no new
   dispatch branch.

Constraints in this slice:
- File size capped at 16 MiB; bigger CSVs should land as `kind: postgres`
  in PR 4.B.
- No streaming yet — full file read per tool call.
- Output schemas declare `array` / `object` types but don't carry
  per-column item schemas; rich schema-aware template validation lands
  in PR 4.C.

Tests: +22 across 3 new files (parser, driver, generated tools, route).
Total 1228 → 1230 passing.
