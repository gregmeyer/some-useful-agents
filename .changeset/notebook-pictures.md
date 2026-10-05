---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Notebook cards get a picture even when the listing has none.

For an option without a photo, sua's new `notebook-picture` agent:
- **finds a representative image:** a Wikimedia photo of that car model and generation, the product's image, or the company's logo;
- **always draws a simple SVG illustration** as a fallback.

Cards label these **example photo** or **illustration**. Found images are fetched with the same guards as listing photos; drawings are rebuilt from an allowlist of plain shapes (no scripts, styles or links) by the new core `sanitizeSvg`. It runs after searches, from **Get photos**, and when a notebook is opened, once per option.
