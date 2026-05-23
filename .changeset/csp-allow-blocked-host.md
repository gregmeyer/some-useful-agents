---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

One-click "Allow" for CSP-blocked widget images on the run-detail page. When a widget renders an `<img>` from a host that isn't in the page `img-src` allowlist, the browser blocks it silently. The run-detail page now listens for the CSP violation, attributes it to the run's agent, and shows a banner with the blocked host(s) and an Allow button. Allowing merges each host into the agent's `permissions.imgSrc` (new version) via the new `POST /agents/:id/permissions/allow-host` endpoint, then reloads so the images render. Full URLs are normalized to bare hosts, so pasting an image URL works too. The replace-everything `/permissions` form on the agent Config tab still exists for manual edits.
