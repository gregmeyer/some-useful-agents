---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Template renderer drops leftover handlebars block tokens instead of leaking them to rendered widgets.

When an ai-template uses an unsupported handlebars form (helpers like `{{#if (eq …)}}`, `{{else}}` branches, or item-scoped `{{#if item.field}}` inside an `{{#each}}` body), the renderer previously left the raw `{{#if …}}` / `{{/if}}` tokens in the output. A safety net now strips any remaining `{{#X}}…{{/X}}` blocks (and bare `{{else}}` / `{{#X}}` / `{{/X}}` tokens) after all supported substitution passes, so unsupported syntax fails closed rather than dumping handlebars source to the page.
