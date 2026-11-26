---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Templates from skills: a generic template drafter, the evaluate-software and software-rubric skills, and a software scorer.

Ask sua for a template from a skill ("build a comparison template for picking a CRM") and the new template drafter follows the skills you name to draft a whole notebook template. It covers what each notebook asks for, its gates, its weighted criteria with what 0–4 mean, and its steps and page. The draft is checked in code before you see it on a **Save the template** card. Agents can now take skills chosen at run time (`skillsFromInput: <INPUT>`). Two shipped skills, `evaluate-software` and `software-rubric`, make comparison templates. The `software-scorer` agent scores each option's criteria from research, and keeps a score only when code finds its quote on the page it cites; everything else stays unknown, never 0. A notebook's FIELDS input now carries each criterion's weight, anchors and side, and an agent's `<notebook>` block that only sets facts on options it already has is filed directly.
