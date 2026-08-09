---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Routing metadata reaches the build surveyor and MCP list-agents.

The build-from-goal discovery catalog now renders each agent's `entryConditions`
("use when"), `nonEntryConditions` ("not for"), and `sampleQuestions` so the
surveyor reuses an existing agent instead of drafting a near-duplicate. The MCP
`list-agents` tool also returns these fields for v2 agents, so an external client
(e.g. Claude Desktop) can route on entry conditions and sample questions rather
than the description alone.
