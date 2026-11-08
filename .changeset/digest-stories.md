---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

A `Stories` view component, and the two-step digest example uses it.

`Stories` draws articles or posts as a feed gives them: a thumbnail (or the source's initials when there is no picture), the title linked to the article, a line of summary, then source · date, with Show N more past `maxItems`. Any agent whose result is a list of `{title, url?, summary?, image?, source?, at?}` can bind it.

The `two-step-digest` example's sample headlines now carry a link, a one-line summary and a thumbnail, and its view is a `Stories` list instead of a two-column table, so the tutorial tile reads like a news digest. Reimport the example to see it (`sua agent reimport packages/core/examples/two-step-digest.yaml`).
