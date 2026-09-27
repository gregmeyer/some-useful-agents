---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Agents as tools: a model can call other agents. Put `agent:<id>` in a step's `tools:`.

The model sees each agent as a tool, described by its description, entry conditions and sample questions, with its declared inputs as parameters. A call runs the agent as a sub-run of the calling run and returns its result. It works on every provider that can call tools (claude via sua's tool endpoint, OpenAI-compatible models) and on a Temporal worker. The same tool policies apply (rules can match `agent:*`), and each call appears in the step's tool-call list.

The limits: no cycles (an agent already in the call chain can't be called again), at most 3 levels deep, only `active` agents, and only agents on the caller's `allowedSubAgents` list when it declares one. Cancelling a run cancels its sub-runs. The run page now lists a run's sub-runs, and each sub-run shows "Called by" with a link back. See docs/agents-as-tools.md.
