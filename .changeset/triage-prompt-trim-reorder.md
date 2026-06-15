---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Slim and reorder the triage prompt to cut per-turn tokens.

A measured triage turn was ~15.5K tokens, of which the runnable-agent specs
(full input schemas, sent every turn) were ~47%. The specs are now compacted to
the structural minimum triage actually needs — input names, types, required, a
short truncated description — dropping the redundant agent-level prose (the
catalog already carries it). That roughly halves the specs block (a measured
turn dropped to ~12K tokens, -23%), with no loss of the input names triage uses
to propose actions correctly. The prompt is also reordered so the static prefix
(rules + catalog) leads and the live message + conversation trail, with a terse
output reminder last — a cache-friendly layout that preserves instruction
following.
