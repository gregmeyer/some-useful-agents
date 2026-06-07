---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Dashboard start: clearer "already running" message + reclaim a stale instance.

When a dashboard is already bound to the port, `sua dashboard start` now probes
its `/health` build stamp and tells you the pid, commit, and build time — and
flags when the running instance is an OLDER build than the one you're starting
(the "I deployed but still see old code" trap). On a TTY it offers to stop that
process and take over; a new `--replace` flag does the same non-interactively.
A foreign (non-dashboard) process on the port is never killed.

The daemon now starts the dashboard with `--replace`, so a leftover hand-started
dashboard is reclaimed on restart instead of silently leaving stale code serving.
