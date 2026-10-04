---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Pin, move and hide things on Home's Today tab, and turn a change into a rule (goal surfaces, S4).

Each row on Today has a ⋯ menu (Pin to top, Move up, Move down, Hide from Home), and rows can be dragged within their region. Changes are saved as yours on Home's surface, and each one shows a bar with **Undo**. When there's a clear rule behind a change, the bar offers it: "Always put failing agents first?", then **Make it a rule**. Hidden items are listed at the end of Today, each with Show or Stop this rule.

New: `POST /surfaces/:id/ops` and `POST /surfaces/:id/restore`. A new surface rule now goes ahead of older ones, and hidden items report whether you or a rule hid them.
