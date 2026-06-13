---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Tighten the inbox detail modal header.

The thread-action row (Summarize / Move to / Fork / Retarget) is gone. Rare verbs now
live behind a single overflow (⋯) menu in the title row: Summarize and Reopen (terminal
threads only). The two confusing cross-agent controls are removed from the human UI —
"Fork" handed the thread off to another agent as a new thread, and "Retarget" re-pointed
this thread's agent; both routes remain for the build/diagnose loop, but neither is
surfaced. Tags now share the meta band instead of taking their own row, and "Open page"
is clarified to "Open full page". The header collapses from four stacked bands to two.
