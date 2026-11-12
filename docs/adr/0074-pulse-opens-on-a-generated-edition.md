# ADR-0074: Pulse opens on a generated edition; the grid is a tab

- Status: accepted
- Date: 2026-11-11
- Deciders: Greg Meyer
- Amends: ADR-0070 ("Pulse stays a grid")
- Builds on: ADR-0070 (a board's page is a layout composed from its agents' outputs), ADR-0073 (Home's Next up and brief)

## Context

ADR-0070 gave named boards a front-page layout and kept Pulse a grid, because Pulse has things a front page has no place for: every agent ("Everything else") and the hidden ones.

In use, Pulse as a first landing point didn't work. A grid is only worth opening once someone has arranged it; an unarranged Pulse opens on five health counters and tabs of tiles. Meanwhile the reading people do every morning, what their scheduled agents produced, had no page: Home listed it as sentences linking to raw run pages, and a named board with the front-page look needs building and keeping up by hand.

## Decision

**Pulse opens on "Today's edition", a board that is generated on each request and never stored.** The grid, with Everything else, the health tiles, hidden agents and Arrange, is one tab away at `/pulse/agents` ("All agents").

1. **Who is in it**: active, scheduled agents (not sua's own) whose latest finished run is from the last 24 hours. Newest first, with the agent Home's brief leads with in front. No agent in it, no edition: `/pulse` is the grid, as before.
2. **Its page is made by code** (`editionDoc`, dashboard `lib/today-edition.ts`), in ADR-0070's vocabulary: a masthead, a lede (the day's headline, the lead agent's own first sentence), then each agent's result as its own view (`AgentTile`, bare, in a Panel). Results whose view has a table go in the wide column; the others beside it (one with a number first, that number set large) and three abreast beneath. No model is involved, and no page agent.
3. **It resolves like a board** (`resolveBoard('today')`), so it is drawn, refreshed and run through the same canvas, data model and routes as any composed board page. Every write (save, arrange, undo, "How it looks") is refused: there is nothing stored to change.
4. **Each result can be linked to**: `/pulse#agent-<id>` scrolls to that agent's part once the page has drawn. Home's reads and brief link there, to the drawn result, not to the run page.
5. Coming back from an action on the grid (a flash message) lands on the grid, not the edition.

## Consequences

- The page someone lands on from "Pulse" is something to read, with no setup.
- The stored Pulse board is unchanged, and so is everything about arranging it. People who arranged Pulse reach it one tab over; `/boards/pulse` now redirects to `/pulse/agents`.
- The edition can't be arranged or saved as a page. (Amended by ADR-0076: it follows stored preferences, changed through sua's review or by asking.) Someone who wants a different arrangement of the same agents makes a board ("+ New board") and gives it the front-page look, which is ADR-0070 as it was.
- An agent with no tile and no view of its own isn't in the edition. It is still under All agents and in Home's brief.
- Which results are "wide" is a rule of thumb (a table in the view). A view that needs width without a table will be squeezed until the rule learns about it.
