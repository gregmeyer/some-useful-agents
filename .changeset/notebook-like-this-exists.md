---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Ask sua for a notebook you already have and it offers to run that one again, or to set the new one up like it.

When you ask for a new notebook, sua checks the ones you have (archived too) by their words, tags and who they're about. The same thing: it links the notebook and offers Run it again or Start a new one. The same kind for someone or something else (a meeting with another person, a briefing on another company): it proposes a Create notebook card that copies that notebook's steps, facts, checks and page with the name swapped, and leaves the original alone. `notebook-create` accepts `LIKE` (a notebook id) in place of `TEMPLATE`.
