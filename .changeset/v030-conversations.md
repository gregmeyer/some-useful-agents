---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Conversations everywhere: one conversation model, and a sua panel beside every page.

Agent chat and the inbox now share one store and one thread view, shown in a sua panel you can open next to any page. sua knows which page you asked from, so "this dashboard" means the one you're on. See [docs/conversations.md](https://github.com/gregmeyer/some-useful-agents/blob/main/docs/conversations.md).

- **Ask sua to fix or change an agent:** sua asks what's wrong first, keeps one conversation per problem, and shows the fix on a card (with its diff) that you approve before it applies. Settings changes work the same way.
- **An agent's Settings tab:** sections in plain words, with one Save.
- **A calmer drawer and thread:** one field to search or ask, grouped threads, suggestion pills, a ⋯ menu with Copy link, and agent widgets inline. Filter, star and act on many threads at once.
- **Archive agents and dashboards** you aren't using; they come back with one click.
- **Boards:** ask sua to arrange the board you're on, a searchable agent picker, and a tunable Suggest a layout.
- sua carries on longer between your replies (12 turns, 24 actions).
