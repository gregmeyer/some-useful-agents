---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Build from goal shows each draft's shape and why, lets you switch it, and lets you try it before keeping it.

Each drafted agent on the review now leads with a diagram of its steps, a plain label (a goal node that works it out itself, or a fixed flow), the tools it uses, and one sentence from the drafter on why it chose that shape (new optional `shape_reason` on drafts). "Make it a goal agent" / "Make it a fixed flow" re-drafts that agent in the other shape. "Try it" runs the draft without saving it (asking for required inputs first) and shows the result with a link to the full trace; trial runs are recorded with `triggeredBy: trial`, never raise inbox items, and stop after 2 minutes (goal agents: their time budget). The Done summary links to each new agent's first run.
