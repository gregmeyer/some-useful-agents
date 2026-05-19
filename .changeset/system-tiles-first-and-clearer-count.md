---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Layout planner: system tiles first, daily second. Pulse count differentiates agents from system widgets.

Two clarifications after live testing:

- **Canonical container order.** The prompt previously offered the LLM a choice between system-tiles-top and system-tiles-bottom. Made it prescriptive: system tiles always anchor the first container ("Health" / "Overview"), daily-glance content second, lower-frequency containers below. FOCUS can still override ("hide system stats"), but the default is now opinionated.
- **Page count differentiates tile kinds.** The Pulse header previously read "16 signals, 28 hidden" which conflated 12 agent tiles with 4 synthetic system widgets. Now reads "12 agents + 4 system · 28 hidden" so the cap that matters to the user (agent count) is visible directly.
