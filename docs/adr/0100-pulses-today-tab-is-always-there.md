# 0100. Pulse's Today tab is always there

- Status: accepted
- Date: 2026-11-22
- Supersedes: in [ADR-0074](0074-pulse-opens-on-a-generated-edition.md), "No agent in it, no edition: `/pulse` is the grid, as before"

## Context

When nothing scheduled had a result from the last day, `/pulse` silently became the grid, and the Today's edition / All agents tabs disappeared. The page changed shape from one day to the next without saying why. A stopped scheduler, or agents that hadn't run yet, made Pulse look like a different page rather than an edition with nothing in it.

## Decision

- **`/pulse` always shows Today's tab, and both tabs always show.**
- **With no edition**, Today says "Nothing for today yet" and why. It lists the scheduled agents (up to 8), each with when it last ran and **Run**: one POST (`/pulse/edition/run`) that runs it with its last inputs. An agent that needs inputs it has never had links to its page instead. Nothing runs because the page opened. With no scheduled agents, it says so and points to All agents.
- **A flash from an action on All agents still lands on All agents** (ADR-0074, point 5).

## Consequences

- Pulse's shape no longer depends on what ran overnight. An empty day reads as empty and offers the fix.
- Tests and links that meant the grid use `/pulse/agents`.
