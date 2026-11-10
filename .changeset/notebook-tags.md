---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Notebooks get topic tags, and the Notebooks list filters by them.

sua gives every notebook two to four topic tags ("used cars", "remote jobs"), archived ones included, reusing the tags you already have. Cards show them, a Tags row under the tabs filters the list by one, and search matches tags and who a notebook is about. A notebook is tagged again when its title, goal or limits change, and one you run again keeps its tags. `notebook-read` lists each notebook's tags. New `notebook-tagger` system agent; new `tags_json` column on notebooks (ADR-0071).
