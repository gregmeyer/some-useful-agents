---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Inbox thread: modern chat surface — chat-bar composer + collapsible tool-call actions.

The thread modal now reads as a terminal-native conversation. The reply box is a single mono-prompted chat bar (`you ›` + auto-growing input + inline Send) where Enter sends and Shift+Enter is a newline; Mark resolved / Dismiss moved into the `⋯` overflow, and Ask triage sits beside a `↵ send · ⇧↵ newline` hint. Finished agent actions collapse to a one-line summary (`✓ Run agent X · completed · 1.5s`) that expands on demand, keeping long threads scannable. Also fixes the thread title rendering error-red (a `.modal h3` cascade collision).
