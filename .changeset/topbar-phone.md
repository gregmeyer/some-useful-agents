---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

The dashboard fits on a phone.

At phone width the pages no longer scroll sideways:
- **Top bar:** 16px gutters. The navigation scrolls within itself, the "need your reply" pill keeps just its dot and count, and Ask sua drops its shortcut hint.
- **Section tabs:** scroll within themselves, with the tab for the page you're on brought into view.
- **Page intros:** wrap instead of squeezing into a narrow column.
- **Wide tables** (runs, tools): scroll within themselves.
