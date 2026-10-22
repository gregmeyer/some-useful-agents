---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

A find or check step given an agent that reads one page at a time uses sua's finder or checker instead.

An agent like listing-page-facts can only fill in facts from an option's own page, so on a find or check step it had nothing to read and the step refused to start. Saving steps (Edit, sua's steps card, a draft) now takes such an agent off those steps, and an older step that has one runs with sua's finder or checker. Either way the notebook says what it did.
