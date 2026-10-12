---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/dashboard": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
---

A notebook step that can't go further stops gracefully, with Move on.

When a step stops short of its goal, sua now offers **Move on** (keep what it found, mark the step done, start the next) alongside **Try again**, as cards in the conversation and as buttons in the notebook's header. When no run got the step any closer, sua says its agent couldn't get any further and puts Move on first; a step still getting closer when it ran out of tries puts Try again first. A running step has a **Stop** button in the header, which stops its run and the step, keeping what it found. Saying "stop" or "move on" to sua proposes Move on.
