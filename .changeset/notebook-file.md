---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Notebook files: copy a notebook to another sua (core).

`exportNotebookBundle` / `importNotebookBundle` write and read a `.suanb` file (gzipped JSON, `suanb/1`): the notebook's setup, steps, page, options and facts, pictures, write-up and given inputs, plus the agents of yours it runs (and the ones they call), your tools they use, and the names of the secrets they need. Importing checks first, installs missing agents and tools, keeps yours where they differ, gives taken ids new ones (references follow), turns the schedule off, and adds a note on where it came from; a failed import changes nothing. The dashboard and CLI use it in a following release.
