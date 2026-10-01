---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Widget controls work in the browser with A2UI; every example widget converts.

Dashboard widgets' sort, filter and paginate controls work on the table in the browser (no page reload), view-switch becomes tabs, field-toggle becomes a collapsible section, and preview fields become a link to the file. The sua catalog's Table gains sortColumns/defaultSort, filterColumns/filterPlaceholder and pageSize; there's a new Disclosure component, and Link accepts dashboard paths. All 26 example Pulse templates and 22 output widgets convert. Long text in a Metric reads as text instead of a giant number.
