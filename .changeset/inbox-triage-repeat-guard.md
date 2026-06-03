---
"@some-useful-agents/dashboard": patch
---

fix(dashboard): stop inbox triage from repeating identical failed actions

When inbox triage proposes a sub-agent action that already failed on
the same thread with the same inputs, the dashboard now refuses the
repeat instead of auto-running the same broken step again.

This prevents loops where triage keeps retrying an unchanged action
until the per-thread auto-follow-up cap is hit, and forces the next
turn to revise the inputs or choose a different next step.
