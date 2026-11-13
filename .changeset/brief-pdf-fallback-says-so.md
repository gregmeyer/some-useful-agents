---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

The brief says when sua couldn't make its PDF.

When the headless browser can't start (not installed, or a Playwright update that needs a newer browser download), the PDF button used to fall back to the print view without a word, which looked like a broken button. The print view now says at the top that the PDF couldn't be made, gives the command that fixes it, and has a Print button; the note shows on screen only. The reason is also logged.
