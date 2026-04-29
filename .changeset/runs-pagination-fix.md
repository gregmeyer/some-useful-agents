---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Fix `/runs` page-size links rendering raw `<a>` HTML as escaped text.

The page-size selector in the runs list footer was building anchor tags as plain strings concatenated with `.join(' ')`, then interpolating into a `html\`...\`` template tag — which escapes string values. The result was visible literal `<a href="...">25</a>` text instead of clickable links.

Switched to the same SafeHtml-fragment pattern the agents-list and tools-list pagers already use, so each link is a `html\`...\`` template literal that the renderer treats as trusted markup.
