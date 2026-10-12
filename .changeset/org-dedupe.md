---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/dashboard": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
---

A company found by different agents stays one option.

In a notebook of organizations, an option whose key matches nothing now falls back to the company name, so `pigment.com`, `pigment` and `lever:pigment` from three agents are one Pigment, not three. A job or other title that isn't the company itself still stays its own option. `NotebookStore.mergeOptions` merges existing copies into one (its own facts first, gaps filled, checks and picks combined, sightings and picture moved).
