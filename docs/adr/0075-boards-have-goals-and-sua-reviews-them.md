# ADR-0075: A board has a goal, and sua reviews it in rounds

- Status: accepted
- Date: 2026-11-11
- Deciders: Greg Meyer
- Builds on: ADR-0070 (a board's page is a layout composed from its agents' outputs), ADR-0073 (code picks, a model words), ADR-0074 (Pulse opens on a generated edition)

## Context

A board was built in one pass and never looked at again. One planner run picked from the person's agents knowing each one's name and description. The request it was built from lived on the build record; the board itself had no idea what it was for, so nothing could say what was missing from it. A real board made this plain: one tile, in a section with a generic title, while three more agents on the same subject sat unused, and nobody could tell whether they belonged.

The ask was to make boards goal oriented and to improve them iteratively: start from a seed, then have sua work out what other agents or content the board should have.

## Decision

1. **A board has a goal**: one sentence saying what someone opens it to find out. It is stored apart from the board's layout (`board_goals`), so arranging, a new look and Undo never lose it, and a board that has never been saved can have one. A build sets it from the request. It is shown under the board's title and can be edited. sua is given it every time it draws the board's page.

2. **sua reviews a board against its goal, a round at a time, and only when asked.** "Improve this board" runs the `board-reviewer` agent once. Code gives it:
   - the goal (or none: then it proposes one first);
   - what is on the board, as the page shows it: each agent's output fields, its latest line, and whether its last run failed;
   - up to 25 agents not on the board, ranked in code by relevance to the goal and the board;
   - what the person turned down before.

   It returns suggestions: an agent to add, or one to leave out, each with a reason. It is told to judge by what an agent returns, not what it is called, and that two agents returning the same thing are one thing.

3. **Code checks, the person applies.** A suggestion is kept only if it names an agent that was shown and is in the right place (a candidate to add, a tile to leave out), and wasn't skipped before. Suggestions appear on the board, each with its own button and Skip. Applying one is a new board version (Undo puts it back), runs an added agent once, and, when sua composed the board's page or it has none, has sua redraw the page with the goal. A page the person picked or arranged is left as it is. Nothing on a board changes because a review said so.

4. **Rounds are stored** (`board_reviews`). "Look again" starts the next round with what was applied and skipped. A round with nothing to suggest says so.

5. **Content is suggested too, and drawn by the board's own page agent** (amended with the third step). Beside agents, the reviewer may suggest a headline, a band of figures, the top item of a list, or a line of context. Code first works out what the board's results can carry (a string field for a headline, a list for a top item, a figure that changes by day for numbers) and drops any content suggestion outside that. Taking one hands the page agent an ask in words with the goal; the suggestion is marked done when the page is saved. Every board's data now has its agents' figures (`/board/figures`), which before only Pulse's edition had.

6. **New agents can be suggested, and go through the approval that exists** (amended with the fourth step). When the goal needs something no agent the person has returns, the reviewer may suggest drafting one (two a round at most), with a purpose someone could build from. Taking it records a build of that board that only drafts (`origin: 'review'`) and reuses the drafter, the critic and the single approval item from board builds. The board doesn't change until the draft is approved.

7. **A build ends with the first review, and its planner sees what agents return.** The request is the goal, so round 1 can run without asking. The planner's catalog now carries each agent's latest fields and first line.

8. **Each board is its own canvas.** A review changes that board's own document; there is no shared template that improved boards converge on.

## Consequences

- A board can be judged: against its goal, something is missing or it isn't. The reviewer's note says what no agent the person has covers, which is where drafting a new agent and content built from the results come in (the next steps of this work).
- One model run per round, plus a page redraw when a change is applied to a board whose page is sua's. None of it runs until the person presses a button.
- The reviewer can be conservative. On the board that prompted this, it found the unused agents returned the same stories as the one tile and suggested adding none of them. That is the rule working, and it means agents alone won't always make a board better.
- "On the board" means what the page shows. A dashboard's old section list can name agents the page no longer shows; those count as not on it.
- The first change applied to a grid board whose page is its own lets sua compose a page for it. Someone who wants the grid back has "How it looks".
