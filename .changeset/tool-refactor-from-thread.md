---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Ask sua to point several agents at a shared tool, from a conversation.

Say "point my job-board agents at a shared tool" and sua proposes `tool-refactor`: two new system agents draft one tool for what those agents' command steps do (or pick one of yours that already does it) and rewrite each agent to call it, each checked with one more try, all without changing anything. It ends in one card to approve (the tool, each agent's change, what was left out), which saves it all or nothing. The analyzer and builder now see your tools too, so a one-agent fix can call one.
