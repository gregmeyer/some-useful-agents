---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Answers don't stall on a check that can't confirm anything, or on options from one site.

A check step now has to earn another try: a try that settles fewer than a quarter of its open option-by-check pairs, and checks no option all the way through, is its last. A check that stops short with a write-up next goes on by itself, and the write-up marks what wasn't confirmed. A shortlist's find step whose options mostly come from one site, with a check after it, tries once more elsewhere before going on, and says how that went. It doesn't apply to a site you asked for or to job boards that host many companies. A find step's agent is now told what's still needed beyond the count. New in core: `stepProgress` reports a check step's `cells`, and `siteSpread`.
