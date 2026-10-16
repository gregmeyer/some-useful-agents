---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

The agent catalog: ask what you want to do, browse the agents you use.

/agents opens with "What do you want to do?":
- **Keyword matches** show at once.
- **sua's agent finder** (the one it uses in a conversation) picks up to three agents, each with why it fits, a question to ask it, and Run. When nothing fits, it offers to build one.

Browsing the User tab shows shelves:
- your go-to agents (starred and most run), the ones used lately, the ones that fill notebooks, and the ones on a schedule;
- then every agent as one line, with demos, tests and never-run drafts folded away.

Cards are slim: what the agent is for, one question, when you last used it, and Run. Filters are folded, and the Calls-other-agents and Feeds-notebooks chips now stay on while paging. Core adds `RunStore.runCountsByAgent`.
