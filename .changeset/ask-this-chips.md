---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Make an agent's sample questions clickable.

`sampleQuestions`, `entryConditions`, and `nonEntryConditions` have been in the schema and read by every router for a while, but they rendered in zero views — so the one person who most needs them, someone deciding whether this is the right agent, could never see them.

An agent's detail page now shows a "What you can ask" panel: every sample question as a chip, plus a "Use when / Not for" block built from the entry conditions. Each agent card carries one chip, and a search that finds nothing offers your own query back as a chip.

Clicking a chip drops the question into the `sua ›` bar, focused and editable. It never submits for you — you see exactly what you are about to send first.
