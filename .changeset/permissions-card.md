---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

dashboard: Permissions card on agent Config tab

Surfaces the `permissions.imgSrc` allowlist (added in #256) on the
agent detail Config tab. New POST /agents/:id/permissions route accepts
a newline / comma / space-separated host list, normalises (lowercases,
strips https:// + paths + ports so users can paste full URLs), dedupes,
validates each entry against the host regex, and creates a new agent
version. Empty input clears the allowlist. Pack-installed agents pick
up the same UI — edits become a local user-version on top of the pack.
