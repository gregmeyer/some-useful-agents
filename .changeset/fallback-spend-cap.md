---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

A daily cap on fallback spend: money spent only because an earlier provider failed.

When codex ran out of quota, every node fell back to Claude, about $75 a day for several days, with nothing to stop it. Settings → LLM now has **Daily cap on fallbacks** (USD a day, off by default) and shows today's total. At the cap, a node stops instead of falling back to a paid provider (Claude, or one with a price), and says why. A paid fallback with room left is held to what's left. A node whose first provider answers, and a free fallback, are never held back. The cap reaches nodes on the Temporal worker too.
