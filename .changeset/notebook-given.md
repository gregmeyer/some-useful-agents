---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

A notebook asks for what it depends on from you, and waits for it.

Ask for "jobs matched to my LinkedIn profile" and the notebook now names the profile as something it needs: the draft and the notebook's page show a box to paste it into, and no step runs until you paste it or choose Go on without it. What you paste is handed to every step (find, source, check, write); going on without it is recorded, told to every step, and shown on the page. A search that turns out to need something asks the same way. The notebook also keeps your request as you typed it, links included (ADR-0077).
