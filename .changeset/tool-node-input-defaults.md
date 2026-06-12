---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Fix: apply agent input defaults to `{{inputs.X}}` in builtin/generated tool nodes.

The builtin-tool execution path resolved `{{inputs.X}}` templates against the
caller's `--input` pairs only, ignoring declared input defaults — so a tool node
templating a defaulted input received an empty string (e.g. a required field
failing with "title is required"). Shell/LLM nodes already applied defaults via
node-env; the tool path now uses the same `mergedInputs` merge, so defaults and
required-input validation are consistent across node types.
