---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

A2UI widgets inline in agent chat; clicking one sends the next message.

On the agent Chat tab, a reply from an agent with a `view:` now shows its widget (drawn by the vendored A2UI renderer in sua's styling) instead of the raw text, which stays one click away. Buttons and other actions in the widget continue the conversation over the chat WebSocket: the action's `context.message` (or "▸ name") becomes your next message. `SanitizedHtml` is resolved and sanitized on the server before a view is sent. Also fixes the chat socket's CSP entry for `[::1]`, which browsers rejected.
