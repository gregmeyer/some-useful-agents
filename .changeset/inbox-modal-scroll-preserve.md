---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Inbox modal: don't yank the operator to the bottom when reading a tall widget.

When an inline output widget (e.g. a cocktail card) is taller than the thread
viewport, scrolling up to read its top was repeatedly fought by the poll-driven
refresh, which swapped the DOM and forced a scroll-to-bottom every tick. The
refresh now preserves scroll position and only follows the latest content when
the operator is already near the bottom; the streaming-reply bubble does the
same; and the post-refresh focus no longer scrolls the composer into view
(`focus({ preventScroll: true })`).
