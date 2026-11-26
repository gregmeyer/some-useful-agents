---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Notebooks can score options against weighted criteria, worked out in code.

A number field with a `weight` (and what 0–4 mean, and a side of the 2x2) is a scoring criterion. Each option scores 0–4 on each; a missing score is unknown, never zero. The notebook's page data (`/notebooks/<id>/data.json`) now carries a `scorecard`: each option's lower and upper bound out of 100, how much of the weight is known, its gates (the notebook's checks: pass, fail or unknown), whether it's ranked, provisional or out, and which other plausible weights would put a different option first. Options get `suitability` and `feasibility` for a 2x2 when enough of each is known. A template can also be saved from a drafted setup, without a notebook (`saveTemplateSetup`), checked first: weights add to 100, every criterion says what its scores mean, steps' agents are installed. This is the groundwork for comparison templates drafted from a skill.
