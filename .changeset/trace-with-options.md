---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Job searches and answers with options get their sources traced and their findings tagged.

A notebook with options that also writes an answer or a write-up (a job search, an answer that kept a few options) now traces its source pages in its Check step, as answer notebooks do, instead of checking only its options. A write-up's findings about options are tagged Verified, Supported or Unverified by how those options did on the notebook's checks. And a done-when like "Talking points written" now ticks once a briefing has its talking points.
