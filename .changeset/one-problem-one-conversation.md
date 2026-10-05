---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

"Ask sua to fix it" continues the agent's conversation instead of starting another.

Asking sua to fix a failing agent, from Home's Today tab or the agent's page, now continues that agent's open conversation if it has one: its run-failure thread, or an earlier "Fix <agent>" conversation. It starts a new conversation only when there's none. On Today, a "Fix <agent>" conversation belongs to the agent's failing item instead of showing as a separate row, so one problem shows once and opens one conversation.
