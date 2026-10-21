---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

The shortlist's "New" filter no longer counts ruled-out options.

With ruled-out options shown, the "Last run → New" filter counted the ones you'd since ruled out, so it could say 4 while the header link, the "New in the last run" CSV and the What's-new brief said 2. A ruled-out option now counts under no run, as it already did for the stage filter.
