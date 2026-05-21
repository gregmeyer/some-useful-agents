---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Add a critic check + drafter prompt guidance so external `<img>` URLs in ai-template widgets don't get blocked by the page CSP.

- **Critic**: `critiquePlan` now scans each ai-template for `<img src="https://HOST/...">` references. Hosts not declared in the agent's `permissions.imgSrc` (or matched by a wildcard like `*.example.com`) become critic errors. The per-drafter retry loop feeds them back so the drafter adds the missing host on the next attempt.
- **Drafter prompt**: explicit STRICT rule with examples — when a template references external image URLs, declare each host in `permissions.imgSrc`. Wildcards supported.

Closes the symptom where a drafted agent rendered with broken images and the browser console showed "violates the following Content Security Policy directive: img-src ..." (`www.thecocktaildb.com` reported).
