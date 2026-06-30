---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Clearer node-timeout errors when the machine slept.

A node's wall-clock timer is suspended while the machine sleeps, so a 300s
timeout could "fire" hours later and report a misleading "Timed out after 300s"
on a run that never actually ran that long. The timeout message now detects when
the elapsed wall-clock vastly exceeds the configured limit and annotates it
("limit 300s, but 3.7h elapsed; the machine likely slept...") so run detail
explains the gap instead of implying a true hang. Operator Stop (cancellation)
keeps the bare message.
