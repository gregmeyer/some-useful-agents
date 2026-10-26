---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Shared Python helpers for shell nodes.

Every shell node finds `sua_helpers` on PYTHONPATH: `upstream()` (reads the whole result, past 32 KB from its file), `last_json()` (the last top-level JSON object in a model's reply), `tagged_json()`, `upstream_json()`, `as_obj()` and `emit()`. Agents used to keep their own copies, and a fix to one missed the rest; every shipped agent now uses the shared ones (lever-job-agent reads a long upstream result from its file instead of a cut-short copy), and the new `shell-steps` skill teaches the builder and analyzer to. See docs/templating.md.
