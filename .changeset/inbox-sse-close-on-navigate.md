---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Fix: dashboard no longer slows down when clicking through nav links in quick succession.

The global inbox live-update stream opened a persistent `EventSource('/inbox/events')` on every page but never closed it, relying on the browser to reap the socket lazily on navigation. Under HTTP/1.1's ~6-connections-per-origin cap (in play on the local dashboard), rapid page-to-page navigation stacked not-yet-closed SSE connections, and subsequent requests — page HTML, assets — queued behind them, producing a progressive stall. The stream now closes on `pagehide`, releasing the connection slot the instant you navigate.
