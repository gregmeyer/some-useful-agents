# 0099. Today's edition says how fresh it is

- Status: accepted
- Date: 2026-11-22
- Builds on: [ADR-0074](0074-pulse-opens-on-a-generated-edition.md), [ADR-0076](0076-the-edition-follows-preferences.md)

## Context

The edition is "what your scheduled agents found in the last day". Since ADR-0076, though, a part you always show is in it whatever its age. A stopped scheduler or a failing agent also leaves old results in place. On a real install the page said "3 scheduled agents reported in the last day" while two of its three parts were 12 and 15 days old and the scheduler was stopped. Nothing on the page said so, apart from a small age in each part's footer.

Parts also drew their agent's whole widget. A tool whose result is a form (weather, with its location box and Run again) put that form in the middle of the read.

## Decision

- **An honest count.** The header counts parts from the last day out of all the parts ("1 of 3 parts from the last day").
- **Each part's age is its Panel's note**, bound to the board data's run age. A part older than a day says it's kept because you always show it. A part whose newest run failed after the shown result says so and links to that run. `editionFreshness` (pure) decides both from the tiles.
- **Problems are stated above the edition**, only when there are any:
  - a stopped scheduler while agents are scheduled (the same rule as Pulse's scheduler tile);
  - "N parts are older than a day", with **Run the N older parts**.

  That button is one POST, and each part runs again with its last inputs. Opening the page never starts a run.
- **Edition parts are drawn to be read.** `buildPulseTile({ readOnly })` is set by the edition and by the tile route when `board=today`, so a refresh keeps it.
  - An interactive widget shows its last result without its input form.
  - The footer's **Run** sends `again=1`, which reuses the last run's inputs (`lastRunInputs`).
  - **Change inputs…** goes to the agent's page.
- **The masthead is the date.** The tab already says Today's edition.

## Consequences

- An old or broken part can't pass for today's. The fix is one press or one link away.
- Changing a tool's inputs moves off the edition to the agent's page (or All agents, where tiles are unchanged).
- The look of an agent's own HTML template, such as a light-only card, is still the agent's. Redesign it with sua (✎) when it doesn't suit dark mode.
