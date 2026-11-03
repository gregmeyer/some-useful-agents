---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

A notebook page fills in place as it updates, and a part with nothing yet holds its place while a step runs.

The page's refresh no longer replaces the whole column when the same parts are in the same places: each A2UI surface takes only its new data model, so nothing jumps and a diagram you moved keeps its what-if. A part that appeared or went, or a changed shape, still redraws the column. While something runs, the page no longer reloads itself every six seconds: the header's working panel is redrawn in place instead. While a step runs (`pending`), an empty Panel keeps its frame and title over three grey rules instead of being pruned, so the page's shape shows from the first minute; the leftovers part never holds a place, and the brief prints nothing for a pending part.
