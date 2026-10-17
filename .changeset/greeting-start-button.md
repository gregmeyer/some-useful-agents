---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

A new notebook's greeting has a Start button for its first step.

After sua says hello in a new notebook's conversation, it now offers a **Start** card for step 1 when it can run it: the step has its own agent, or uses sua's finder or checker, and it isn't one of yours. Before, sua waited for you to say "start". The button runs step 1, the same as the header's Next step. It does nothing once the step has started.
