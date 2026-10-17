---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Replies stream on the Temporal backend too, and wide tables in a conversation scroll instead of being cut off.

With the Temporal provider, sua's replies and chat agents' replies used to arrive in one piece; now their text, tool calls and widgets stream as they're written, about once a second. A table wider than the sua panel now scrolls sideways.
