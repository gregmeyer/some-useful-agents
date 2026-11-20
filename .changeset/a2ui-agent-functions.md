---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

A notebook's page can search its options as you type.

Using A2UI 1.0 agent functions, a notebook page can ask the dashboard for something while you use it: `findOptions` (the options matching what you typed, best first) and `optionFacts` (one option's facts). A search box over a long shortlist now filters as you type, without redrawing the page. They answer only about that page's own notebook and only read it.
