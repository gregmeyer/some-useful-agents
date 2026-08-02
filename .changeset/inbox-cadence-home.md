---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

feat(home): inbox-as-front-door — a cadence-organized feed leads Mission Control

The home page (`/`) now opens with the inbox instead of a status board. A
cadence feed organizes your threads by time — Needs you / Today / This week /
Earlier — plus a "sua closed these" ticker, so the front door answers "what's
happening now" at a glance. Each row carries a task-2×2 nature tag
(scheduled ⏰ / ad-hoc ⚡ · deterministic ⚙ / non-deterministic 🧠) derived from
the thread's agent, so you can tell "must I act" from "can I just read" without
opening anything. The Pulse board and recent-activity feed are demoted to
collapsed "Signals" / "Recent activity" zones below the feed — nothing removed,
just reordered so the conversation leads. The feed stays live via the existing
global inbox SSE stream, and rows open the thread in place.
