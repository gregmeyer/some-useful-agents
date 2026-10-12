---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

A notebook draft is kept until you start or discard it.

Drafts used to live in the dashboard's memory for an hour, known only to the page, so going to another page lost them, and your changes to a draft were never saved. Now a draft is stored (a new `notebook_drafts` table), has its own address (`/notebooks/new?draft=…`), saves your changes as you make them, and is listed under "Drafts you haven't started" on the Notebooks page and the New notebook page, with Continue and Discard. Starting the notebook clears it.
