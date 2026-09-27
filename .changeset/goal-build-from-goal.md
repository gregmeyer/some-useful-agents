---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Build-from-goal drafts goal agents for open-ended asks, and a fourth starter shows the pattern.

When a request is open-ended (find, compare, research, figure out), the drafter now writes one `goal` step with tools and a budget instead of guessing a chain of fetch-and-summarise steps. It can list existing agents as tools (`agent:<id>`). The design rules and patterns that the drafter and surveyor read explain when to use a goal step and when to use a flow. The build critic checks that every `agent:<id>` tool names a real agent (and not the agent itself). The smoke check flags a model-callable tool id that isn't in the tool catalog.

New starter **Work something out** (`starter-goal`): a one-step goal agent that answers a specific question from pages it chooses to read. It's on `/start` as the fourth pattern, "Work it out". The roadmap's outcome-driven-flows planner is marked superseded by goal agents.
