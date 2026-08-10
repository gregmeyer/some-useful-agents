---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Surface the local-model tool loop's tool calls in the run record + run detail.

The OpenAI-compatible tool loop now emits a progress event per model tool call
(`tool_use`, `toolStatus:'call'`) and per tool result (`toolStatus:'result'`,
with `isError`), carrying the tool name and a short args/result preview. These
persist to the node's progress record and render as a compact call → result
timeline on the run-detail node card.

Why it matters: previously a run only showed the final text, so you couldn't
tell a real tool round-trip from a plain completion where the model ignored the
exposed tools (or hallucinated using one). Now the tool calls are visible — and
their absence on a node that exposed tools is an at-a-glance signal that the model
didn't actually call anything.
