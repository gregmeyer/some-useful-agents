---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/dashboard": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
---

Check that each kind of notebook still gets a page that fits it, and no empty boxes on a drawn page.

Eight example notebooks (a used car, a job, accounts, a product, meeting a person, a call with a company, a question, a trip) are checked on every change: the right kind of page, valid with and without data, reading well, every part bound to data it has, an outline snapshot, and a brief that prints the page in its order. `npm run notebook-pages:eval` scores the real page agent against a baseline; `npm run notebook-pages:layout` opens every page in a browser and flags holes, overlong parts and sideways scrolling. A drawn page now leaves out parts with nothing in them yet; the brief of a page whose header has a side part prints the whole page again (it printed only the side part); and the brief shows 3 to 5 of what they said, one per theme first, with every one in the extended brief.
