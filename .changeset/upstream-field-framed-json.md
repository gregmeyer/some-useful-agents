---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

`{{upstream.<node>.<field>}}` now reads a JSON object on the upstream node's last line, not only an all-JSON output.

An llm node that reasons in a sentence and then ends with a JSON object (what the starter agents ask for) had its fields resolve to empty strings in downstream prompts, while `onlyIf` read the same fields fine. `starter-watch`'s alert was handed a blank evidence and why, so every fired watch said it "didn't capture any quoted text". Field templates now use the same last-line rule the executor uses for a node's structured outputs.
