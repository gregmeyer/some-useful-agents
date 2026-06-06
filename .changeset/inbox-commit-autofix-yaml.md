---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Fix inbox-built agents rendering literal `{ {outputs.X}}` in their widget.

The template pipeline escapes `{{` → `{ {` to prevent re-expansion. The dashboard
build wizard repairs this before committing (via `autoFixYaml`), but the inbox
auto-commit path (agent built from a thread) skipped that repair, so the escaped
form was persisted and the output widget rendered a literal `{ {outputs.X}}`. The
inbox commit path now runs the same `autoFixYaml` repair the wizard does.
