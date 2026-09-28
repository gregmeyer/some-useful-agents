---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Inbox triage no longer replays an entire long thread into every turn.

Triage and the learning extractor now see the most recent 16 KB of a thread, with a note saying how many earlier entries were left out (the original ask and the latest one are always in the prompt). Approved learnings are budgeted in bytes rather than characters. Agent conversations, memory recall and the inbox now share one budget helper (`budgetTranscript` / `takeWithinBudget` in core).
