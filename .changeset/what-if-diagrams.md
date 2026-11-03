---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

An answer's ladder or split can be moved: sliders above the drawing recompute it in the browser, and Reset puts it back.

The writer may name up to two what-ifs on a ladder or a split (`params`: the amount it divides, a ladder's longest term, its number of rungs); the value is always the diagram's own, so the slider rests on what was written. The page draws a slider per what-if above the diagram, recomputes it as you move (a split re-divides in its parts' proportions; a ladder scales its rungs, or rebuilds equal rungs for another count) and keeps what you moved it to in your browser only; nothing is written to the notebook, and Reset clears it. The arithmetic is shared with the server (`assets/diagram-math.js` mirrors core's `recomputeDiagram` and the dashboard's layout; a test keeps them the same). The brief prints the diagram as written and says where it moves; the page agent sees which parts can move and prefers one as the hero.
