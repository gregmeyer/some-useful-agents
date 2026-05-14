---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Postgres integration kind with auto-generated find/find-one/count tools (PR 4.B)

Second slice of PR 4 of the Settings → Integrations workstream.
Adds a `kind: postgres` integration that introspects
`information_schema` once at add-time and synthesises three read-only
tools per table:

- `postgres.<id>.<table>.find` — typed `where` / `order_by` / `limit`
- `postgres.<id>.<table>.find-one` — single row
- `postgres.<id>.<table>.count` — `COUNT(*)` with optional `where`

How it works:

1. Paste the DSN into Settings → Secrets (e.g. `DATABASE_URL`).
2. Add a Postgres integration at `/settings/integrations?tab=postgres`
   referencing that secret name + the schemas to introspect (default
   `public`).
3. On save, sua opens a connection, walks `information_schema.columns`
   + the primary-key view, builds a typed snapshot, stores it on the
   integration row, and closes the probe pool.
4. At run time, agents reference any synthesised tool via the standard
   `tool:` field. The DSN is re-read from the encrypted secrets store
   per execute call; a pooled `pg.Pool` (1 per integration, 2 conns
   max, 30s idle) handles the actual queries.

Trust posture:

- Identifiers (schema, table, column, order_by direction) are
  validated against the snapshot before splicing into SQL — no quoted
  or mixed-case identifiers in this slice.
- `where` keys are checked against the table's column list before any
  query runs; values are bound, never interpolated.
- DSN never leaves the encrypted secrets store + the per-integration
  pool's memory.
- Read-only: no insert / update / delete tools. Writes deferred to
  PR 4.D.

Adds `pg ^8.20.0` as a runtime dependency. ~200 KB, well-maintained,
zero new transitive secret-shaped strings.

Tests: +18 (mapColumnType unit cases, generated-tool synthesis +
resolution + execute error path, dashboard tab render + missing-DSN
error). Plus 3 live tests that exercise introspection +
parameterised reads against a real Postgres — gated by `PG_TEST_URL`,
skipped without it.

Total 1230 → 1242 passing (12 net new actually run; 3 skipped pending
CI Postgres service).
