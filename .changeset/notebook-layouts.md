---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

A notebook's page layout is an A2UI document, with the shortlist as the first preset.

The page every notebook had (where it stands, the map, the funnel, the shortlist, the checklist, the timeline, coverage and limits) is now the **Shortlist** layout: an A2UI document bound to the notebook's data, kept per notebook and carried by templates. A layout can use any catalog component; `when` draws a part only when the notebook has it (a map needs a price and a measure), and `/notebook/layout/…` values fill in settings from the notebook. Existing notebooks draw exactly what they did. This is the groundwork for layouts that fit other outcomes, such as a meeting briefing or a report (ADR-0056).
