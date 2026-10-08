---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Scatter charts say what each dot is when you hover or tap it.

Every `Scatter` widget (a notebook's "Where they sit", or any agent view or board that uses one) now shows a note for the dot nearest the pointer: its name, both values in full ("Price $3,495 · Miles 177,967"), and where it stands (best, its stage, ruled out and why, outside your limits). Overlapping dots can be told apart, and the chart can be read from the keyboard (arrow keys, Escape). The chart also follows the design system now: dots in the neutral tone with teal kept for the best one, round axis ticks ($3k, $4k… instead of $3.1k, $4.9k…), and a legend whose marks match the chart.
