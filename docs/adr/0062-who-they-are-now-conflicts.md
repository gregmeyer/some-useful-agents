# ADR-0062: When what was found disagrees with who they are, say so and let it be settled

- Status: accepted
- Date: 2026-10-26
- Deciders: Greg Meyer
- Builds on: ADR-0061 (the write step), the profile step

## Context

A meeting notebook's profile step learns who someone is from their own pages (role, company, where they're based). Its find step then gathers what they've written or said. On a live notebook these disagreed: the profile said "Founder, Intelligist Group" (from his firm's site), while two topics quoted him saying he's now at Contentful (a post from October). Only the writer noticed, in its last "Watch out for" line. The page and the talking points stated the profile's version as fact, and the check "Confirm his current role" was never met.

## Decision

- **Find conflicts with a model; keep and settle them in code.** A system agent, `notebook-reconciler`, compares the profile's facts with what was found.
  - It runs in the background after a find, source or profile step, and synchronously before talking points are written.
  - It names only conflicts about the present (a current role, employer, place, what the company does), each side with its source and date, plus the question that settles it.
  - It never decides, and never adds facts of its own.
  - `cleanConflicts` keeps only facts the profile has, sides that come from a real page or an option the notebook has, and at most 3 per person or company.
- **Kept on who they're about** (`NotebookAboutOne.conflicts`):
  - open conflicts are replaced on each run;
  - settled ones stay;
  - a settled one is raised again only when a new value appears.
- **Shown at the top of the notebook until settled:** the question, each side linking to its source with its date, then **Check it** or one button per side.
  - The header renders it, so every page layout shows it.
- **Settled two ways:**
  - **you pick:** the fact takes that side's value and source;
  - **Check it:** `research-one` looks the fact up as of today, with both sides as leads, and a sourced answer settles it (as `research`). If no page settles it, it stays open and the notebook says so.
- **The writer states neither side:** a contested fact is left out of its facts and given as `unsettled`. The writer opens with a question that lets them say, and puts the disagreement in "watch". sua's notebook focus includes it, so it can answer about it in the conversation.

## Consequences

- Talking points no longer present a stale role as fact.
- One small model call follows find, source and profile steps on notebooks that know who they're about. No call is made on other notebooks.
- Settling is per fact. Two sides that may both be true (their own firm and a job elsewhere) are still raised, since the profile names only one. The question asks which is their main work now, and picking either side settles it.
