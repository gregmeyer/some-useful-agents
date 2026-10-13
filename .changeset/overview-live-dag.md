---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

An agent's Overview shows a run in progress on its diagram.

While a run is going, the Overview opens the diagram, the running step pulses (as it does on the run page), and the heading says which step is working ("Running: fetch"). It follows the run every two seconds and reloads when it ends, so Latest result shows what it made.
