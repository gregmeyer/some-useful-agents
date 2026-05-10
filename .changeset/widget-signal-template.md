---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Planner prompts: teach the LLM to use `signal.template: widget` when the agent has an `outputWidget`.

Pulse tile rendering is dispatched by `signal.template`, NOT by `outputWidget.type`. An agent with `outputWidget: { type: ai-template, template: <rich HTML> }` and `signal.template: text-headline` will silently render the bare headline on Pulse — the ai-template work is wasted.

Both planner prompts (`agents/examples/agent-builder.yaml` and `agents/examples/build-planner.yaml`) previously omitted `widget` from the allowed `signal.template` list, so wizard-built rich-output agents could never reach Pulse with their template. Both now:

- Include `widget` in the allowed list
- Explicitly recommend `signal.template: widget` whenever the agent declares an `outputWidget`
- Note that `signal.mapping` should be omitted in that case (the widget drives layout)

The schema, autoFix, and Pulse Configure dialog have always accepted `widget` correctly — this PR closes the prompt gap that was preventing wizard-built agents from emitting it.
