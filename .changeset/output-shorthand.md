---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Accept shorthand string form for `outputs:` declarations.

LLM-generated YAML routinely writes `outputs.url: string` (the shorthand) instead of the verbose `outputs.url: { type: string }`. The schema now accepts both forms — the parser normalises the shorthand to the verbose object form, so downstream consumers always see the canonical shape. Fixes the painful "Fix with AI" loop where every Suggest improvements run hit the same `Expected object, received string` validation wall.

The autofixer (run-now-build → autoFixYaml) also rewrites shorthand to verbose form so the canonical stored YAML stays stable in git.

Camel-case output names (`mediaType`) still need to be renamed to snake_case (`media_type`) by hand — the schema can't auto-coerce keys without breaking template references.
