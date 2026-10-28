---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Updating a shortlist now sources the new options too.

**Update all** (and sua's **Update it** card) runs a done source step after Search again, for just the options that search found: an agent that reads each option's own page reads each new one (up to 8), and another agent is given only those. So new roles or listings arrive with their facts (level, pay, price) filled in before they're checked. Options it already had are left to the step's own button.
