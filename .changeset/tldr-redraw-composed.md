---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

A TL;DR redraw is always composed, shaped for its page.

**Redraw** on the TL;DR picture page now always lays the card out as an A2UI view, and never picks a fixed layout. Unless you say otherwise, it follows what the notebook's page prefers: landscape, leading with the bars for a shortlist, the portrait or photo for a briefing, the sources' photos in a grid for a subject, and the headline and findings for an answer, runbook or plan. The page shows that preference, and **Fit this page** asks for it with one press.

If sua can't compose the card, the picture stays as it was, and the page says why and offers **Try again**. The MCP `notebook-tldr` tool now replaces a composed card when it's given a layout.

Also fixed:
- A composed card no longer shows the same photo twice when two sources share it, even when one is a resized copy.
- A photo set beside the words under the card's header now sits inside the card's margins. It no longer runs off the card's left edge or up against the headline.
- Two older forms only allow going back to a page on this dashboard: installing a pack (`returnTo`) and allowing an image host (`redirect`). Before, they also followed `//other-site` or `/\other-site` off the dashboard.
