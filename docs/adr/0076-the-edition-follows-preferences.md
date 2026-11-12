# ADR-0076: Today's edition is improved through preferences, not a saved page

- Status: accepted
- Date: 2026-11-11
- Deciders: Greg Meyer
- Amends: ADR-0074 ("The edition can't be customised")
- Builds on: ADR-0074 (Pulse opens on a generated edition), ADR-0075 (boards have goals; sua reviews them)

## Context

ADR-0074 made Pulse open on an edition generated on every request, with nothing stored, and said someone who wanted it different should make a board. ADR-0075 then gave boards a goal and a review. The page people land on every day was the one page that could not be improved: it showed every scheduled agent that reported, in an order the code chose, whether or not each belonged in a morning read.

The ask: the default Pulse should be improvable too, both through sua's review and by asking in words, with the result remembered.

Saving the edition as a page would end what makes it the edition. A stored page holds yesterday's set of agents; an agent that stops reporting leaves a hole, a new one never appears, and the day's lead and figures are frozen at whatever they were.

## Decision

**What you change about the edition is kept as preferences its generator follows** (`EditionPrefsStore`, one row):

- `lead`: the agent whose result leads (its first sentence is the headline, and it goes first);
- `hidden`: agents left out;
- `include`: agents shown whenever they have a result, though they have no schedule or didn't run in the last day;
- `wide` / `narrow`: which column a result takes, whatever its view;
- `numbers: false`: no "By the numbers" band;
- `topStory`: the agent whose top list item is shown, linked, under the headline;
- `note`: a line of the person's own under the masthead.

**They change only by ops** (`applyEditionOps`: `lead`, `hide`, `show`, `include`, `width`, `numbers`, `top-story`, `note`, `reset`), checked against the agents that exist and have a result. An op naming any other agent is refused, so what is stored always refers to something real. One step of Undo.

**A preference that can't be honoured today is skipped for today, not dropped.** A chosen lead that hasn't reported lets the day's figures lead; it leads again when it's back.

**The edition has a goal and can be reviewed** like a board (ADR-0075). The same reviewer reads the edition as it would be drawn now. Taking a suggestion maps to an op: add an agent → `include`; leave one out → `hide`; headline from X → `lead`; numbers → `numbers`; top story from X → `top-story`. New agents aren't drafted for the edition, and the line under its title is the person's to write.

The edition still can't be arranged or saved as a page.

## Consequences

- The page someone lands on each day gets better with use and stays generated: tomorrow's edition has tomorrow's results, in the shape they chose.
- The vocabulary is small on purpose. Anything outside it (three columns, a different band) is a board, which is its own canvas.
- The same ops serve a suggestion that is taken and a change asked for in words, so there is one place where "what can be changed about the edition" is defined and checked.
- Preferences name agents by id. An agent that is deleted leaves a preference that matches nothing and does nothing.
