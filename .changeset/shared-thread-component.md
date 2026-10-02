---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/dashboard": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
---

The inbox thread and the agent Chat tab share one thread component.

Messages in an agent's Chat tab now look and behave like inbox messages: a Copy button on each reply, Markdown in your messages, consecutive replies grouped under one speaker, and timestamps on hover. The inbox thread looks the same as before. This is the groundwork for the side panel, which will show both kinds of conversation.
