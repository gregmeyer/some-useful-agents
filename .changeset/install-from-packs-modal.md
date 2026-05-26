---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Install packs from Pulse without leaving the page.

The dashboards dropdown's "+ Install from Packs" now opens an in-place modal
listing every registered-but-uninstalled pack, each with an Install button, plus
a single "Browse all packs →" link to the full packs page. Installing posts to
`/packs/:id/install` with `returnTo=/pulse`, so you land back on Pulse with a
success flash instead of being bounced to the pack detail page. The install
route now honors a loopback-only `returnTo`. Without JS the link still navigates
to `/packs`.
