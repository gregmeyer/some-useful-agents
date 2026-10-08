---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Replay from a node reuses the inputs the original run had.

A replay used to start with no inputs, so an agent with a required input failed at the replayed node ("Missing required input") and one with defaults quietly ran on the defaults instead of what you asked for. Every run now saves its inputs and a replay starts from them; for older runs they're read back from the run's node logs. `sua workflow replay` takes `--input KEY=value` to change some of them.
