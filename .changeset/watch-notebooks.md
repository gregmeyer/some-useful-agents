---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/dashboard": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
---

A notebook that keeps watch says what changed since last time, first.

A watch notebook ("tell me when a used X100V under $1,200 shows up") searches on a schedule, every morning unless you say otherwise. The drafter sets that up with a find step and no decide step. The new ready-made **Watch** page, which sua picks for these notebooks, leads with what changed since the search before the latest: new options, price changes (marked better or worse), other facts that changed, ones whose page said they're gone, and ones the latest search didn't find again, with a line summing it up. All of it is worked out from what the notebook keeps (core `notebookChanges`), never by a model. The first search reads as a first look. The new **Changes** widget is in the A2UI catalog, and the data paths are `/notebook/changes` and `/notebook/changesIntro/*`.
