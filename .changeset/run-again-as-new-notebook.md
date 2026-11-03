---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Run a notebook again as a new notebook: the same setup, none of the content, the old one archived.

Edit → Manage this notebook → Run again as a new notebook… (or tell sua "clear this and run again" and approve the card) creates a fresh notebook with the same setup (what it's for, limits, done-whens, checks, stages, fields, steps with their agents, schedule, pipeline, its page and whose it is), none of the content (no options, notes, decision, answer or plan, who it's about, photos or history), starts its first step, and archives the one you were on; each notes the other, and Restore brings the old one back. No template is made. New `notebook-rerun` conversation action; `createNotebookFrom` takes `layoutBy`.
