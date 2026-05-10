---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Tool-policies PR B: file shape, loader, executor seam (always-allow stub).

Defines the on-disk schema for `.sua/policies.json` (`version: 1`, `defaultAction`, `rules[]`) plus `loadPolicyDocument(dataDir)` which reads the file when present and returns the default allow-all document otherwise. Malformed JSON or schema-invalid files throw `PolicyLoadError` rather than falling back silently — operators want a loud failure on configuration bugs.

The dag-executor now runs every tool dispatch through `evaluatePolicy()` before calling `tool.execute()`. **No behaviour change today**: the function is a stub that always returns `{effect: 'allow'}`. PR C drops in real glob matching + condition evaluation here without touching downstream dispatch.

New `'policy_denied'` value on `NodeErrorCategory` and a corresponding `PolicyDeniedError` class. The executor's tool-dispatch catch is special-cased so a thrown `PolicyDeniedError` lands in `node_executions.errorCategory` as `policy_denied` instead of the generic `setup`. Policy denials are intentionally NOT in the default retryable-categories list — denying is a stable signal.

`extractPrimaryResource(node, toolId)` extracts the URL/path/command the tool would touch, ready for PR C's matcher to glob against. Templated values are returned as-is (the seam runs before substitution, by design — authors can write deny rules against literal template strings).
