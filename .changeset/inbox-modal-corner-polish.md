---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Inbox thread modal: tidy the header corner + make the collapsed-action toggle findable.

The top-right cluster was three mismatched controls (a heavy "Open full page" pill, a bare star, and an overflow menu with a stray `▸` leaking from the global `details>summary::before` caret). They're now one consistent 28×28 icon row — `⤢` (open full page) · `★` · `⋯` — matching the modal's `×`. The collapsed tool-call action row, previously near-invisible bare text with a faint caret, now reads as a subtle clickable chip (raised fill + hairline border + a clear caret that turns teal on hover), so it's obvious it expands.
