---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Every kind of notebook checks its sources' quotes.

Before, only a notebook that wrote an answer or a write-up had its source pages traced (each quote looked for on its page, in code), and only at its Check step. Now the pages any step files are traced on their own once that step finishes, in the background: shortlists, meeting, company and topic briefs, watches, and Search again, Look again and Update all. A Check step that comes next waits for that trace and reads only what's left. An answer's Check step, which has no checks of its own, now starts on its own when the steps run straight through.
