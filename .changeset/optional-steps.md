---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

One site failing no longer sinks a whole multi-site search.

**New node field, `optional: true`:** if that node fails or times out, the run carries on. The failure is recorded, other nodes still run, nodes that depend on it get a note in place of its output ("(step "autotrader" didn't finish: …)"), and the run can still complete. A cancellation or a budget limit still stops it.

sua's builder marks each source node of a multi-source agent optional, so a merge step always runs with whatever the sources found.
