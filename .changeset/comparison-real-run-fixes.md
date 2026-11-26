---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Comparison templates, fixed after a real run: answers you already gave fill a new notebook's asks, and drafts are checked for what broke.

A notebook started from a template no longer waits for something you already told sua (a budget, the tools you use). The **Create notebook** card carries those answers (`GIVEN`) and lists them. Each one is kept as given and as read, so neither the first step nor the page asks for it again. A template drafted from a skill is now refused, with the reason, when it has more than 12 facts (before, the facts past 12 were silently dropped and the weights looked wrong) or a source step with no agent. The drafter is told to keep criterion labels short and step titles under 60 characters, and to leave no placeholders. New ADR-0105 records why comparison scores are worked out in code, unknown is never 0, and templates come from skills.
