---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Dashboard polish bundle.

- **/tools** now has **User** / **Built-in** tabs with per-tab counts and pagination — replaces the combined grid where builtins filled the first page.
- **/agents** gets the same treatment: **User** / **Examples** tabs (and a conditional **Community** tab when relevant). Source filter dropdown folded into tabs.
- **Variables editor** supports `enum` inputs end-to-end: new values column that accepts comma-separated or JSON-array form; enum without values surfaces a clear error instead of silently saving.
- **Pagination size links** (`12 24 48 100`) rendered correctly on `/tools` — previously HTML-escaped by the tagged template.
- **Pulse "Output Widget" tile** explainer is now informative: describes the four widget types, how fields map to output, and links to `/agents/<id>/config`.
