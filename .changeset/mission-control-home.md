---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Unify the dashboard front door: a Mission Control home.

The root `/` was a stripped-down Pulse (system stat tiles only) while the
inbox — the most powerful surface — was a quiet nav link with no presence. `/`
is now an attention-ordered front door: a "Needs you" strip of inbox threads
awaiting your reply on top, the live Pulse board (system + agent signal tiles,
reused read-only) in the middle, and a collapsed recent-activity feed at the
bottom. A global Inbox badge (count from the new `/inbox/needs-you-count`) shows
on every page. `/pulse` stays as the focused, fully-editable board-only view —
both render the identical board via a shared `renderPulseBoard`. New core inbox
queries `countNeedsYou` / `listNeedsYou` back the badge and preview.
