---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

CSP `frame-src` and `img-src` were missing the Vimeo + youtube-nocookie
hosts that the iframe sanitizer's allowlist permits. The browser
silently blocked Vimeo iframes (and their poster images) even though
the sanitizer rendered them. Added `https://player.vimeo.com` and
`https://www.youtube-nocookie.com` to `frame-src`, plus
`https://i.vimeocdn.com` to `img-src` for the Vimeo CDN's posters.

CSP block now mirrors the host allowlist in
`packages/core/src/html-sanitizer.ts:IFRAME_ALLOWED_HOSTS`. Comment
above the directive flags this — any future host added to the
sanitizer must also be added here or it'll silently 4xx in browsers.
