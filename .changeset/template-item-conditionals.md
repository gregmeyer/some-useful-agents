---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

ai-template `{{#each}}` blocks now support item-scoped `{{#if item.field}}` and `{{#unless item.field}}` conditionals.

LLMs reach for the per-row form constantly when describing "show a link if the row has a url, else show a dash." Previously only `{{#if outputs.NAME}}` was supported, so authors who wrote `{{#if item.url}}` inside an `{{#each}}` got both branches rendered with raw `{{#if …}}` / `{{/if}}` tokens leaking to the page. The `#each` body rewriter now evaluates item-scoped conditionals per-iteration. Bare `{{#if item}}` (testing the whole item) also works, useful for primitive arrays. Single-level only, matching the `#each` body's non-greedy match. Discovery catalog updated to advertise the syntax.
