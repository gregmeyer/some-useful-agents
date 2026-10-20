---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Shared Python helpers for shell steps.

Every shell step now finds `sua_helpers` on PYTHONPATH: `upstream()` (reads the whole result, past 32 KB from its file), `last_json()` (the last top-level JSON object in a model's reply), `upstream_json()`, `as_obj()` and `emit()`. Agents used to keep their own copies, and a fix to one missed the rest; research-one and research-fanout now use the shared ones, and the new `shell-steps` skill teaches the builder and analyzer to. See docs/templating.md.
