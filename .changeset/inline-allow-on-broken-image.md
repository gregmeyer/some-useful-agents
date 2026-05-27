---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

CSP-blocked images now show an inline "Allow this host" card on the tile.

Building on #376 (which surfaces blocked hosts as pills on the agent
config page), this PR closes the friction loop without forcing the user
to navigate at all: when an `<img>` is blocked by the page CSP, a small
themed card appears in place of the broken image with a `+ Allow <host>`
button. Clicking it POSTs to `/agents/:id/permissions/allow-host`, adds
the host to the agent's allowlist, and shows a Refresh button (the
current page's CSP header is frozen for its lifetime, so a fresh
document render is needed to pick up the new policy).

Also fixes a latent bug in the existing CSP-violation listener
(introduced in #376): for `img-src` violations Chrome sets `e.target`
to `HTMLDocument`, not the offending `<img>` element, so
`findOwningAgentId` never found the owning tile and nothing was ever
reported in the wild. Now uses `e.blockedURI` to match against
`<img>` `src` / `currentSrc` / `data-failed-src` to locate the
element. Tests passed because they POST directly to the endpoint;
the client capture wasn't actually firing until this fix.

A tiny `securitypolicyviolation` buffer in `<head>` catches violations
that fire during body parse, before the main script bundle at the end
of `<body>` has registered its listener. The main listener drains the
buffer on load.
