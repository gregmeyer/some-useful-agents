---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Persistent `sua ›` ask band on every page; Signals move to a first-class `/pulse` page; snappier navigation.

The `sua ›` prompt is now global chrome — a band under the top bar on every page (prominent on the home front door, quiet on inner pages so it doesn't compete with page headings). Focus it from anywhere with `Cmd/Ctrl+K` (or `/`), and an in-progress draft survives navigation. Signals (the Pulse board) moved off the crowded home into a dedicated **Pulse** page with its own nav item; home now leads cleanly with the cadence inbox feed (recent activity lives at `/runs`). The client JS bundle is served as one cached external file (`/assets/dashboard.js`) instead of being inlined into every page, so the browser parses it once and navigation no longer re-parses ~370KB on every page load.
