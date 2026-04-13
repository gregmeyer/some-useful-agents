# ADR-0002: SQLite via `node:sqlite` built-in

## Status
Accepted

## Context

The run store needs a persistent datastore. Requirements:

- Local, single-user; no server required
- Queryable — listing recent runs by agent name, status, time range
- Concurrent-safe — CLI and MCP server can both write simultaneously
- Zero-config for new users
- Works on macOS / Linux / Windows

Candidates considered:

1. **JSON file per run** (`data/runs/<uuid>.json`) — our original plan.
   Dead-simple but no queries, no indexing; `list runs from last hour` means
   a full directory scan and parse. The moment the dashboard needs even
   basic filtering it becomes a rewrite.

2. **better-sqlite3** — popular, mature. Native addon; requires compilation
   on install. Breaks for some contributors on odd platforms. Adds a build
   step to every install.

3. **node:sqlite** — built into Node.js 22.5+ as of 2024. Zero native deps,
   zero install-time overhead, shipped with the runtime. Works on every
   platform Node supports. API is similar to better-sqlite3 but newer with
   less battle-testing.

## Decision

Use `node:sqlite` directly. Pin Node 22.5+ via `.nvmrc` and `engines` field.

Enable WAL mode (`PRAGMA journal_mode=WAL`) on connect so concurrent CLI +
MCP writes don't block each other.

## Consequences

**Easier:**
- Contributor onboarding has zero install-time native compilation.
- Publishing to npm works from any CI runner without setup-cpp or prebuilt
  binary matrices.
- Platform support is identical to Node's.

**Harder:**
- `node:sqlite` is newer than better-sqlite3; edge cases we haven't hit yet
  may lurk.
- Type declarations for `node:sqlite` changed once already between Node
  minor versions; we had to pin a specific `SqlValue` type shape locally.
- Anyone stuck on Node < 22.5 can't use the project. We don't try to support
  older LTS.

**Trade-offs accepted:**
- Slightly less battle-testing vs better-sqlite3. The project is a local
  playground, not a high-concurrency service. If we hit a bug, we can swap
  back to better-sqlite3 with a 20-line shim.
