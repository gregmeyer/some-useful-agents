---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

`ai-template` widgets now populate `{{#each}}` blocks from JSON wrapped in prose or a markdown fence — the common shape for claude-code summarisers that lead with a note and emit their JSON inside a ```json fence.

`renderAiTemplate` previously did a bare `JSON.parse(output)` to seed top-level arrays / objects into the outputs map. Anything other than pure JSON threw, the outputs map stayed empty for top-level keys, and `{{#each outputs.rows as r}}` blocks rendered to nothing. Scalar fields (`{{outputs.total}}`) survived via the existing `extractField` backfill, but arrays didn't — extractField returns stringified JSON, which breaks `Array.isArray()` inside `#each`.

Switching to `parseJsonFromOutput` (same recovery logic PR #274 added for scalar extraction) closes the asymmetry: arrays + objects now reach the template from prose-wrapped JSON the same way scalars already did.
