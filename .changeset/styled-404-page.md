---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Styled 404 page that wraps the standard layout (topbar, theme toggle,
suggestion cards) instead of the previous bare `<p>Not found</p>` scrap.

The catch-all in `index.ts` and the unknown-id paths in the new
dashboards routes now render `renderNotFoundPage`. Shows the requested
path (HTML-escaped), an optional context message, and a card list of
common destinations (Agents / Pulse / Packs / Runs).
