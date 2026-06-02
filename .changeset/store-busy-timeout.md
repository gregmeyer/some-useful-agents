---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Guard SQLite stores against startup lock contention.

Stores set `PRAGMA journal_mode = WAL` but never a busy timeout, so `node:sqlite`
raised `database is locked` the instant it couldn't grab a lock. When the daemon
restarts the schedule, worker, and dashboard services at once they race to open
the same DB file, and one would crash on startup ("Could not start the temporal
provider: database is locked"). Stores now open through a shared `openStoreDb`
helper that applies `PRAGMA busy_timeout` (5s), so SQLite waits and retries
instead of failing. Behavior-preserving in the uncontended case.
