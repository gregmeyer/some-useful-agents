---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

A new notebook decides its own page from what it's for.

Once a notebook is set up, a new system agent (`notebook-page`) keeps the shortlist for a choice among many options, or draws a page that fits another outcome (a briefing before a meeting, an answer to a question, a plan) from the A2UI catalog. Nothing to approve: the greeting says what was drawn, and Undo on the Edit page puts the shortlist back. A template's page is never replaced. Edit → More → "Pick a page for what it's for" lets any notebook, old ones included, decide again.
