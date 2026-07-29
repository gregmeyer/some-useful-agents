---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Durable inbox follow-through: restarts no longer strand triage chains, and Stop survives reboots.

All triage follow-through state used to live in-memory, so a dashboard restart mid-chain left action cards stuck `running` forever and killed in-flight conversations silently. A new boot reconciler settles every stranded action against run-store truth (completed while down → finalized with its result; run gone → failed with a restart-explaining reason), re-attaches waiters to genuinely in-flight Temporal runs, and — when auto-triage is enabled — re-fires triage once per thread whose turn died with the old process. With auto-triage off, interrupted threads surface as "Your turn" instead of sitting silently.

The operator Stop button is now persisted (`paused` column on inbox messages): a silenced thread stays silenced across restarts, and the auto-triage sweeper will never re-engage it. Replying still lifts the pause.
