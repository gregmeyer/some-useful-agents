---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Record every tool call a model makes, and show it on the run page.

A new `tool_calls` table records every tool call a model makes during an llm-prompt node: tool, arguments, result preview, error, timing, and the provider that made it. That covers sua tools called through the OpenAI-compatible tool loop and claude's own tools (WebFetch, Bash, …), which are read back from its event stream. Before this, claude runs showed only "Using a tool...", and nothing was stored beyond 200-character previews. Records ride on the node's result, so Temporal runs are recorded the same way as local ones. Retention removes them along with their runs.

The run page lists each node's calls with a `native` marker for a provider's own tools, and each call expands to its full arguments and result. This is the trace that behavior grading and outcome evidence need.
