---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Tools is now the one home for everything an agent can call.

Five nouns meant roughly "a thing an agent can call", split across two navigations: Tools and Nodes
under Agents, and Integrations, MCP and MCP Servers as three separate Settings tabs. Two of those
sat next to each other named "MCP" and "MCP Servers" while being opposite directions of the
protocol — one is sua exposed *as* a tool for Claude Desktop to call, the other is servers sua
imported tools *from*.

`/tools` now has four tabs: **Built-in**, **Imported** (was "User tools"), **Servers** (moved from
Settings → MCP Servers) and **Integrations** (moved from Settings). The old URLs
302-redirect and preserve their query strings, so bookmarks and deep links to a specific
integration kind keep working. `/settings/mcp` is renamed **Claude Desktop**, named for what it
does now that its confusable neighbour has moved out.

This also fixes a link that sent people in a circle. The Integrations page said "No MCP servers
connected. Add one at Settings → MCP Servers first" — but that page cannot add a server; it tells
you to use Tools → Import. The empty state now points at the import page directly.

**Nodes becomes "Node reference" under Help**, at the same URL. It is hand-authored documentation
about how agents are built, with nothing to create or delete, and nothing in the product linked to
it — it was reachable only by clicking its own nav tab. Help now links to it.

The runtime error for a disabled MCP server names the new location too.

Recorded as ADR-0034, which sets three navigation rules the next surface can be placed by:
direction decides the section (what sua can call vs. what can call sua), reference documentation
does not get a nav slot, and a resource is managed beside the thing it produces. The nav had
flip-flopped four times with no ADR at any point.
