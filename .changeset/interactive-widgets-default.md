---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Pulse tiles for parameterized agents now ship with the inputs form + re-run button by default.

The flag (`outputWidget.interactive: true`) was always available, but neither the agent-builder nor the build-planner prompted the LLM to set it — so every wizard-built search/lookup agent rendered as a static tile on pulse, with the re-run UI only available on the `/agents/<id>` detail page. The agent-builder + build-planner prompts now both instruct the model to set `interactive: true` whenever the agent declares runtime `inputs:`.

Also flips the flag on `agents/examples/ashby-job-finder.yaml` so it benefits immediately.
