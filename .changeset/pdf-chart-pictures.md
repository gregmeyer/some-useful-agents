---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Charts print as pictures in a notebook's brief and PDF.

A VegaChart on a notebook's page now shows in its brief, saved file and PDF as the chart itself, not a table of its numbers: sua draws it on the server with the same Vega the page uses, with nothing fetched and no code run, and embeds it as an image. A chart that can't be drawn still prints its data as a table.
