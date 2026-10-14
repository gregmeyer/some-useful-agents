---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Replies stream on the Temporal backend too, and wide tables in a conversation scroll instead of being cut off.

With the Temporal provider, sua's replies and chat agents' replies used to arrive in one piece. Two problems caused it. The dashboard read the worker's progress from the wrong place in the workflow description and never decoded it. And Temporal throttled the worker's heartbeats to one every 24 seconds or more. Now the worker reports the text written so far about once a second (text deltas folded into one string per node, so the report stays small). The dashboard decodes it and passes on what's new. A chat turn run durably is watched until it ends, so its text, tool calls and widgets stream and the conversation hears when it's done. A table wider than the sua panel now scrolls sideways.
