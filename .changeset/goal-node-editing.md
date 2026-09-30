---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Add and edit goal nodes in the dashboard, with a real tools picker.

The Add node page has **Work toward a goal**: a goal box, a searchable checklist of the tools and agents the model may use (with tool-policy blocks shown per row), a budget, and an optional provider/model. Goal nodes open in the same form to edit instead of sending you to YAML. `llm-prompt` nodes get the same tools picker in place of the comma list. Goal nodes show as teal hexagons in the diagram, `agent:<id>` tools appear under Agent calls, and a one-node goal agent's Overview leads with its goal. Agent capabilities now count the tools a node's model may call.
