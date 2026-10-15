---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Notebook templates: save a notebook's setup and start new ones by asking sua.

**Save one:** on a notebook, Edit → Save as a template. It keeps the setup (what it's for, limits, done-whens, fields, checks, stages, steps and their agents, schedule), never the options, so each new notebook starts empty.

**Start one:** ask sua ("start a notebook from my Job search template", or Start with sua → on New notebook). sua asks what's different this time (one or two button questions at a time, at most 4), then offers a Create notebook card that shows the setup and the changes. Approving it creates the notebook. New notebooks from the form and from a template are now created the same way.
