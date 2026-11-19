---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

An answer's Check step traces its sources, and each finding says whether what it cites is really there.

An answer notebook's Check step used to do nothing ("0 of 0 checked"). It now reads each page the answer learned from and looks for the quote the finder copied from it, word for word, in code: "9 of 12 sources traced". Each finding is tagged **Verified** (its quote is on a primary page, the thing's own spec or docs), **Supported** (on another page) or **Unverified** (none of its quotes found), on the page and in the brief. The writer is told which sources' quotes weren't found.
