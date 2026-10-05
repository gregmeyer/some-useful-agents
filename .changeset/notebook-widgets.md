---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

A notebook's options are drawn as widgets: a summary, stats, the funnel, a price map and a shortlist.

Once a notebook has fields and options, the top of its page is an A2UI view:
- **Summary and stats:** a one-line summary, then in the running, best price, furthest along and ruled out.
- **How far they got:** the funnel, with ruled-out counts and reasons.
- **Where they sit:** price against the main measure, with your limits shaded and the best option highlighted.
- **Shortlist:** cards (photo, rank, price, facts, stage, price move) or a table. **Move to the next stage**, **Rule out…** and **Bring back** work right on the cards and redraw the widgets.

The sua catalog gains two components, `OptionGrid` and `Scatter`, and `Funnel` shows ruled-out counts. The same components work for any notebook.
