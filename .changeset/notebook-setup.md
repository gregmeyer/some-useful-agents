---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

sua sets a notebook up for you: what each option records, and the stages they go through.

**When it happens:**
- when you start a notebook (from its goal);
- the first time you open a notebook that has options but no fields;
- right after sua files an option from your conversation.

**What it does:** sets fields and stages to fit the goal (car fields for a car search, salary as a range and the company for a job hunt), and gives options already in the notebook their facts from their text, so the widgets appear without a search. Options you mention in conversation are filed with their facts too.
