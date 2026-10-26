---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Ask sua to change a notebook's page: it draws it as A2UI and you approve a card.

In a notebook's conversation, ask for the page you want ("show who they are at the top", "make this a briefing"). sua proposes a **Change the page** card (`notebook-layout`) with the whole page as A2UI, checked before it's offered, and the card lists what it adds, removes and changes. Approving draws it, even before the notebook has options; a stale card refuses. The last 20 changes to a page are kept, to undo from the Edit page's **How it looks**.
