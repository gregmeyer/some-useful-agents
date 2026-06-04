---
"@some-useful-agents/core": patch
"@some-useful-agents/dashboard": patch
---

fix(inbox): add safe runnable agents and inline action widgets

When inbox triage proposes a sub-agent action that already failed on
the same thread with the same inputs, the dashboard now refuses the
repeat instead of auto-running the same broken step again.

This prevents loops where triage keeps retrying an unchanged action
until the per-thread auto-follow-up cap is hit, and forces the next
turn to revise the inputs or choose a different next step.

It also adds a per-agent `permissions.inboxRunnable` opt-in so selected
local or community agents can be proposed safely from inbox threads,
and renders compact static output widgets inline for completed inbox
actions when the agent's widget is safe to show in-thread.
