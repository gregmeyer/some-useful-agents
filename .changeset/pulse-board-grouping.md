---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

The Pulse board is grouped and ordered by how recently you used each agent.

The board rendered every tile into one flat grid in `listAgents()` order, which
is effectively arbitrary. On a real install that meant 31 tiles where an agent
you had never run sat at identical visual weight, in no particular place, next
to one you ran sixteen minutes ago — the ordering carried no information at all.

Tiles are now grouped into **Health** (system metrics), **Recent** (ran within
seven days, newest first), **Idle** (ran longer ago), and **Never run**. Empty
groups are omitted. Since Pulse is a run console, the useful sort is what you
used last; never-run tiles are collected rather than scattered, because on a
board where every tile is runnable they are one click from being useful.

The board also explains itself when it has no tiles. Previously it rendered an
empty grid with no indication of why the page was blank or what would populate
it; there is now a real empty state, with a distinct message for the case where
every tile is merely hidden.

**One-time layout reset.** The client re-renders the grid from `localStorage`, so
a stored layout would silently defeat the new grouping for anyone who had loaded
Pulse before. The board now publishes a layout version and the client reseeds
once when it changes. Tile palettes, sizes and collapsed state are stored under
separate keys and are unaffected; only manual tile *arrangement* resets.
