---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Notebook options can show a photo of the actual car, flat or product.

- **A kept copy:** a notebook keeps a copy of each option's photo, taken from the option's image field, or from its listing page's own preview photo when that page is the listing. sua tries after each search and when you press **Get photos**. Cards show the photo beside the facts.
- **Guarded fetching:** photos are fetched with the same guards as web pages (no private or local addresses), must be a real JPEG, PNG, GIF or WebP under 3 MB, and are served from your dashboard, never the seller's site. Addresses that fail aren't retried.

Core adds `fetchImage` and `pagePreview` to the web fetcher.
