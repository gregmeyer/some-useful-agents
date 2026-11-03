---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Once an answer or plan is written, its notebook composes its page around it.

A notebook used to draw its page from its setup alone, so an answer notebook kept the ready-made Answer page with every written part in one block, in the order written. Now, when a write step writes the answer or the plan (and each time it's written again), the notebook decides its page once more, seeing the shape of what was written: each part's key, kind and size, and the done-when it delivers, never its words. sua composes the page around those parts: one hero (a diagram over a table, a rubric over steps) just after the answer, each other part where it reads best, a long table low or folded, and a place for anything written later. The conversation says what leads; Undo on Edit puts the page before back. Each written part now has a key from its title, `AnswerSections` takes `only` (those parts, in order) and `rest` (the parts nothing else places), and `/notebook/section/<key>` binds one part by path. A part whose key is gone leaves its place out; a new one shows in the leftovers. The page eval scores whether a written page is composed.
