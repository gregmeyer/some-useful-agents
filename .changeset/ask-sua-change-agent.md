---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Ask sua to change an agent's settings in plain words.

The Settings tab has an **Ask sua to change this agent** box. What you type opens a conversation in the side panel, and sua answers with a **Change N settings** card listing each change as before → after (model, schedule, durable runs, where it shows, AI-app access, image hosts). **Apply** saves them the same way the page's Save does. sua can propose the same card in any conversation about an agent. New `agent-settings` action (`inputs.CHANGES`), and inbox triage now sees the agent's current settings.
