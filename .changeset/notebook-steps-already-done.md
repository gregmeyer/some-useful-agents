---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/dashboard": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
---

Steps set up on a notebook partway done start where the work is.

When a notebook's steps are set up (by hand, or from sua's card in the conversation), each step whose goal the notebook already meets is marked done, in order, up to the first one that isn't, and sua says so in the conversation. Next step starts there, instead of asking you to press through work that's already done. A decide step is never done for you. A check step on a notebook with no checks now reads "0 of N checked" instead of looking complete.
