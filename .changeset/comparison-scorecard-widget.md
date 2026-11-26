---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

A Comparison page: the scorecard and a fit-against-feasibility 2x2.

A new ready-made page, Comparison, for notebooks that score options on weighted criteria. Its Scorecard shows each option's score as a range out of 100 (the unknown part dashed), how much is known, its gates, and its 0–4 on each criterion, with — for unknown and a link to each score's source; provisional and ruled-out options say why, and it names the leader and any weights that would change that. Its 2x2 plots suitability by feasibility with midlines and a word in each corner, the leader highlighted, and leaves out an option with too little known. The Scatter view component gains these 2x2 options (`domain`, `xMid`, `yMid`, `quadrants`, `bestBy`), and `Scorecard` is a new notebook component.
