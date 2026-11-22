---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

A picture from a busy site is tried again instead of given up on.

When an image host says it's busy (HTTP 429 or 503), sua waits as asked (up to 4 seconds) and tries once more. A full-size Wikimedia Commons original that is still refused falls back to its 1600px thumbnail, and requests to Wikimedia now say who they are, as Wikimedia asks of automated clients. This covers every picture sua keeps: a notebook's lead photo, source photos, and logos.
