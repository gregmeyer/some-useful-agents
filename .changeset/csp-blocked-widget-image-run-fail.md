---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Fail runs whose widget output references CSP-blocked image hosts (root-cause fix).

When an ai-template widget rendered an `<img>` from a host not in the agent's
`permissions.imgSrc`, the browser silently blocked it and the run-detail auto-poll
re-fired the CSP violation on every 2s refresh — filling the console with repeating
"Loading the image '…' violates the following Content Security Policy directive"
errors.

Fixed at the source: the executor now checks a finished run's widget output against
the agent's `permissions.imgSrc` and, if it references an un-allowlisted image host,
marks the run **failed** with an actionable error naming the host(s)
(`unallowedWidgetImageHosts` / `formatBlockedImageError`, new in
`@some-useful-agents/core`). The run-detail view hides the broken widget for such a
run (so the blocked image never renders or re-fires the violation) and renders a
**server-side** one-click "Allow host" form per blocked host — robust because the
hidden widget fires no CSP violation, so a client-JS banner would have nothing to
react to. The `allow-host` endpoint accepts that form POST and redirects back to the
run (same-origin redirects only); allow the host, then Retry run. As a safety net,
the live poll also pauses when any CSP img-src violation is detected
(`window.__suaCspPaused`), so residual cases on rendered widgets can't spam the
console either.

Separately, widget images that load from an *allowlisted* host but still 404 (an
LLM hand-wrote a Wikimedia path with the wrong hash, so the run completes but the
image is dead) no longer show a broken-image glyph. A capture-phase image-error
listener swaps any failed widget `<img>` for an inline SVG "Image unavailable"
placeholder (`data:` URI, permitted by the CSP `img-src` allowlist), preserving
the failed URL in a tooltip. This is the graceful fallback for hallucinated image
URLs that slip past the host-level checks.
