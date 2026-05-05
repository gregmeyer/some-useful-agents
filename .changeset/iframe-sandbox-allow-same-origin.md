---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Add `allow-same-origin` to the iframe sandbox so YouTube/Vimeo embeds can
load posters and play-button overlays.

YouTube's embed page hits its own origin's storage on init to render the
poster image and player chrome. Without `allow-same-origin`, those calls
fail and the iframe shows blank. Safe under the existing host allowlist
invariant: every approved host is a third-party origin (youtube.com,
vimeo.com), so granting same-origin lets the embed reach **its own**
cookies, never ours. Locked the invariant in a comment so future hosts
can't be added on the dashboard's origin without explicit review.
