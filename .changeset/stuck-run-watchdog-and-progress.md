---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Runs that are slow no longer look stuck, and genuinely-hung runs get reaped.

**Live progress.** A running run/node now shows a ticking `m:ss` elapsed timer
(was a static `—` for the whole node) plus a "working…" label, so a slow LLM
node — `agent-analyzer` and friends run 45–200s on a single call and stream
nothing until the first token — visibly counts up instead of reading as frozen.

**Stuck-run watchdog.** Orphan reaping was boot-only, so a run that wedged
while the dashboard stayed up (executor child died but the row never finalized,
or a node hung past its timeout on a machine that slept) sat in `running`
until the next restart. A periodic watchdog now reaps such runs within ~30s —
but only LOCAL runs that are provably not progressing (dead child process,
PID-liveness checked; or past a 30-minute max runtime), never a live one, and
never a Temporal run (Temporal recovers its own).
