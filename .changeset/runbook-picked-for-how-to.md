---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

A notebook that asks to be taught something starts on the Runbook page.

"Teach me how to make a PB&J sandwich", "walk me through filing a 1099" or "how do I set up a Raspberry Pi" now starts on the Runbook page, and its write step writes a runbook (steps with how, what you'll see and if not). A question such as "how do I choose a CRM?" still gets the Answer page. Once written, a Runbook page is kept as it is instead of being recomposed around one part, and the page agent's "Let sua pick" knows the Runbook page too. New in core: `asksForRunbook(notebook)`.
