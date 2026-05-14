---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

`kind: sqlite` integration with auto-generated find / find-one / count tools (PR 4.E of Integrations).

Point at a local SQLite file from Settings → Integrations → SQLite. sua
introspects every base table via `sqlite_master` + `PRAGMA table_info`
and synthesises three read-only tools per table:

- `sqlite.<id>.<table>.find` — typed `where` / `order_by` / `limit`
- `sqlite.<id>.<table>.find-one` — single row (or null)
- `sqlite.<id>.<table>.count` — COUNT(*) with optional `where`

Mirrors PR 4.B's Postgres connector but with no DSN, secret, or pool —
the file path is the whole config and `node:sqlite` (Node 22+ built-in,
already used throughout) is the driver. Per-row schemas populate
`rows.items.properties` so PR 4.C's save-time template validation
catches column typos on SQLite-backed agents the same way it does on
Postgres-backed ones.

Read-only by default. Tables whose names don't match the safe
identifier rule (lowercase letters/digits/underscores) are skipped at
introspection time so no SQL injection vector reaches the generated
tools.
