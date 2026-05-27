---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Dashboard crash logging: stack traces + signal names in `dashboard.log`.

Before this PR, `dashboard.log` only contained the startup banner. If
the dashboard hit an uncaught exception, an unhandled promise rejection,
or any route threw, the process died with no trace — operators saw
"daemon status: stopped" and an empty log.

Now:
- A 4-arg Express error middleware (`error-middleware.ts`) catches any
  route that throws synchronously or via `next(err)`, writes a
  timestamped line to stderr (`[ts] ERROR METHOD PATH → STATUS: msg`
  + full stack), and responds with a 500 that points at the log
- The CLI `dashboard start` command registers
  `process.on('uncaughtException')` and `process.on('unhandledRejection')`
  handlers that write `FATAL ...` lines before exiting 1
- Shutdown signals name themselves: `dashboard shutting down (SIGTERM)` /
  `(SIGINT)` so the log distinguishes graceful stops from crashes

The daemon supervisor already pipes stderr to `dashboard.log`, so
nothing changes operationally — the contents just become useful.
