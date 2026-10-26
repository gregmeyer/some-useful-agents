---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

A new notebook decides its own page from what it's for, and decides again once it knows more.

Once a notebook is set up, a new system agent (`notebook-page`) keeps the shortlist for a choice among many options, or draws a page that fits another outcome (a briefing before a meeting, an answer to a question, a plan) from the A2UI catalog. Nothing to approve: the greeting says what was drawn. Once its first step reaches its goal (who it's about learned, its first options found), it decides again and says so in its conversation, but only while the page is still its own pick: a look you picked, one from a card you approved, or a template's stays. On the Edit page, **How it looks** has **Let sua pick** for any notebook, old ones included, and **Undo the last saved change to how it looks**.
