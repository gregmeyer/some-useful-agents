---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

A picture's link kept as a fact no longer stalls a photo correction.

When a notebook had a picture's link saved as a fact about someone ("image", "photo_url"), the correction agent couldn't tell it from the photo the page shows and asked which one you meant. That fact now says it's only a link, and a new link aimed at it changes the photo itself.
