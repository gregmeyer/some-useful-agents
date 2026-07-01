---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Triage can now see a whole run's output, not just the first ~2KB.

`FOCUS_AGENT_RUN` (the latest run output triage answers from) was capped at 2000
chars. A verbose data agent — an MLB scoreboard is ~8KB, a full slate of 15
games — got sliced off after ~4 entries, so triage genuinely couldn't see the
row the operator asked about ("did the Mariners win?" with the Mariners game
deep in the payload). The cap is now generous enough (12KB, 14KB total) that a
full data payload reaches triage intact, still bounded so a pathological dump
can't blow the prompt (it truncates with an "open the run" pointer). The triage
kernel also tells it to read the whole payload before answering a data question,
and to link the run rather than guess when the output is genuinely truncated.
