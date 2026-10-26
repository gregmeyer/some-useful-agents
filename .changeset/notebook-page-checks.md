---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/dashboard": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
---

Example notebooks check that each kind of notebook still gets a page that fits it.

Eight example notebooks (a used car, a job, accounts, a product, meeting a person, a call with a company, a question, a trip) are checked on every change. For contributors, `npm run notebook-pages:eval` scores the real page agent against a baseline, and `npm run notebook-pages:layout` opens every page in a browser and flags holes, overlong parts and sideways scrolling.
