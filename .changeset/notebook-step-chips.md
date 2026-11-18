---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

A notebook's steps fold to chips while nothing runs.

The steps strip took about 270px of a notebook's header even with nothing running. Now, while no step runs and none is stuck, every notebook shows one chip per step (`✓ Find 4/5`, `✓ Source 18/20 · short`, `○ Pick 3 · yours`). Each chip opens a small card with the step's progress, why it moved on, and its actions. Update all follows the chips, and All steps opens the full strip. A running or stuck step shows the full strip as before. This replaces the one-line fold that only briefings, answers, plans and watches had.
