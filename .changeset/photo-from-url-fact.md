---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Options get their real listing photo in more cases.

- **A link in another field counts:** when a notebook has no listing-link field, the first fact holding a web address (for example "Availability: https://…") is the option's listing. That gives it a photo and a Listing button.
- **A drawing no longer blocks a real photo:** an option with an example photo or an illustration still gets tried for its listing photo, and a real photo replaces it. A failed try keeps the picture it has.
- **When they're tried:** listing photos are now tried when you open a notebook, not only after a search.
- **AVIF:** images are no longer requested as AVIF (which isn't kept), so image servers that negotiate formats send a kept format instead. Target's product images, for one, now come through.
