---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

sua can ask with a form: typed and picked answers, a button that waits until they're valid.

In a conversation (the inbox or an agent's chat), sua and chat agents can now put a small form in a reply when the answer is typed or picked (a budget, a date, which of several): inputs, and one button that stays off until its checks pass (required, an email, a number). Pressing it sends the answers as your reply, written as a sentence ("Budget 400, rental"). This uses A2UI 1.0's input bindings, checks and `userMessage`; a list in that message is said as words, not JSON.
