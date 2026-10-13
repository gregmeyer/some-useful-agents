---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Any agent's chat reply can include a widget, drawn as it streams.

On the Chat tab, agents may add a widget to a reply when it helps (a comparison table, key numbers, choices to click), written as an `<a2ui>` block between their words. The widget builds up while the reply streams, each component appearing once it's complete, and the saved reply draws it in place. One component that doesn't check out shows as a short note instead of losing the whole widget. Widget blocks are left out of the history the agent sees next turn. Also: widgets in chat no longer show blank bands from the message's pre-wrap text style.
