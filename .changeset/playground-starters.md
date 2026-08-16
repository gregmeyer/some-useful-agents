---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Add a curated "Start here" surface with three starter agents.

`sua init` installs every bundled example (40+), which is a wall for someone
four minutes into the product — and it made the zero-agent onboarding in the
dashboard dead code, since the agent count is never zero.

Rather than install fewer agents, this curates the view. A new
`playground-starters` pack names three agents, one per pattern: **Research a
topic** (you give it a goal, it decides what to open), **Watch a page** (the
same agent on a cron), and **Draft something** (the output is the deliverable).
They render at `/start`, with their tools and inputs visible before you run
anything, and everything else stays one click away under Agents → Examples.

These three are also the first bundled agents to use the `tools:` field, so
they double as the reference implementation for an LLM node that calls builtin
tools mid-answer.

Connecting a model now lands on `/start` instead of the home feed, so the
first-run loop ends with something to run rather than an empty inbox.

Also adds a test over the packs actually shipped in `packages/core/packs/` —
`loadBuiltinPacks` swallows per-file failures into `skipped` and the dashboard
swallows the whole call, so a malformed manifest or dangling `yamlPath` would
previously have shipped silently. And corrects the README/quickstart claim of
"15 bundled examples".
