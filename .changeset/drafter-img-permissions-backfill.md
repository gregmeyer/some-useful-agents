---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Auto-backfill `permissions.imgSrc` from outputWidget template at agent
create/upsert time.

The drafter prompt teaches the LLM to declare `permissions.imgSrc` for
external image hosts, but the field is optional and the LLM
occasionally forgets — leaving the user with a broken-image tile on
Pulse + a CSP error in the console.

`AgentStore.createAgent` / `upsertAgent` now run a defense-in-depth
static-analysis pass: any `<img src="https://HOST/…">` in
`outputWidget.template` has its hostname extracted, baseline CSP
hosts filtered out (img.youtube.com, i.vimeocdn.com), and the union
merged into `permissions.imgSrc` before persistence. Wildcard entries
the drafter declared (e.g. `*.unsplash.com`) are preserved — the
analyser can't infer those. Idempotent — re-saving an agent whose
hosts are already declared doesn't bump the version.

Belt-and-suspenders with the runtime inline-allow card (#377): every
new draft now ships with correct permissions; existing agents pick up
the backfill on their next save. The card stays as the catch-all for
late-binding images and edge cases.
