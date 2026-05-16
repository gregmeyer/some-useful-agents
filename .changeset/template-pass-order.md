---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Fix ai-template renderer truncating tables when `{{#if outputs.X}}` wraps an `{{#each}}` whose body contains item-scoped `{{#if item.X}}…{{/if}}`.

Outer `{{#if outputs.X}}` was processed first with a non-greedy body match, so it terminated at the FIRST `{{/if}}` — the inner item-scoped closer — truncating the wrapped table after the first cell and dropping every row. Reorder the passes so `{{#each}}` runs before outer `#if`/`#unless`: per-iteration rewriting consumes item-scoped `{{/if}}` tokens first, leaving the outer block with a balanced body. The wrapping pattern is the natural LLM-authored form (`{{#if outputs.X}}…table…{{/if}}{{#unless outputs.X}}…empty…{{/unless}}`) and now renders correctly. Regression caught by the greenhouse-search-discovered widget showing zero table rows.
