---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Changing a briefing's pull quote changes the page.

Asking sua to change the quote under a person's name ("that line is the podcast host, not him") produced a card, and applying it said the quote had changed, but the page, its brief and the PDF kept the old line. The pull quote was picked from the sources each time the page was drawn and wasn't something a correction could reach, so the new quote was stored where nothing read it. The pull quote is now a part a correction can change: the line you choose leads the page, and the line you said isn't theirs leaves the page's quotes too.
