---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

New `web-screenshot` tool: a picture of a page, kept with the run.

An agent can take a screenshot of a web page (the first screen or the whole page) as proof of what it said, or for a page whose text can't be read. Each picture is kept with its run under `run-files/<run id>/` and shown on the run page under its node. Every request the page makes is checked against private addresses. Needs Playwright's Chromium (`npx playwright install chromium`).
