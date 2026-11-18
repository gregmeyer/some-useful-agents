---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

An `llm-prompt` node can put its fixed instructions in `systemPrompt`, and sua's inbox triage now does.

`systemPrompt` is templated like `prompt` and holds what's the same on every call. Claude gets it as an appended system prompt, which its prompt cache keeps between calls. Other providers get it at the head of the prompt, as before. The inbox triage agent moves its kernel, tool policy and source playbook there. Those were about 25k tokens processed afresh on every sua reply, out of a prompt of about 120k with little cache reuse, so replies should start sooner and cost less.
