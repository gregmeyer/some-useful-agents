---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

A notebook's header is compact: its steps on one row, its buttons beside the title.

The steps used to wrap into a grid with one left over, cut off agent names, and split their status across lines. The header's buttons floated in a mostly empty right column. Now:
- The steps sit in one row, in order, each with its count and a status chip (done, moved on, stuck, running, to do).
- On a notebook drawn as widgets, the buttons sit beside the title.
- A finished notebook's steps shrink to one line each.
- A decided notebook lists its picks, each linking to its page, instead of one long sentence.
