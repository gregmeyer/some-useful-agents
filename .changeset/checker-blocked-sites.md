---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

sua's checker names sites that refuse automated reading, and skips their screenshots.

A site that answers the checker with a 401, 403 or 429, or a bot-check page, is now spotted in code: it's named in the run note ("g2.com and crunchbase.com refused automated reading…") and no screenshot is spent on it, since a browser is refused too. Before, naming it depended on the model reading the screenshot, which missed it.
