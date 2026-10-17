---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

sua's replies use the same widgets as chat agents, answer buttons included.

When sua asks a question with a few likely answers, like which weekend you mean, it can offer them as buttons. Clicking one sends it as your reply. sua's replies now stream word by word, its widgets draw while it writes them, and they sit in place in the reply. Once you've answered, the buttons are spent and your pick is ticked. sua and chat agents work from one list of widget components, and every conversation keeps widgets in one format (ADR-0047 amendment). Earlier replies with a widget under them still show.
