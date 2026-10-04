---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

An agent's Config tab is now Settings: sections in plain words, with one Save.

The tab has a section menu (Inputs, Model, When it runs, Where it shows, Connections, Access), and each section has a one-line summary. Model, schedule, visibility, AI-app access and image hosts no longer have a Save button each. Changed sections are marked, and one bar says how many changes are unsaved, with Discard, Review (before → after) and Save. Save applies everything as one new version when the change affects what the agent does. New `POST /agents/:id/settings` validates the whole set at once (`preview=1` returns the changes without saving) and refuses to save over a version someone else made since you opened the page.
