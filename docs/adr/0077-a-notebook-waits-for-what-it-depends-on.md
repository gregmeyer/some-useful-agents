# ADR-0077: A notebook names what it depends on from you, and waits for it

- Status: accepted
- Date: 2026-11-12
- Deciders: Greg Meyer
- Builds on: ADR-0055 (one step queue), ADR-0044 as amended (an agent's run can't reach the operator's own apps)

## Context

A notebook was asked for "a job search that is well matched to my LinkedIn profile", with the profile's link. LinkedIn can't be read. The notebook was made and searched anyway:

- the drafter rewrote the request as the notebook's statement and dropped the link; the request itself lived only on the draft row, deleted when the notebook started;
- the unreadable page was one clause in the draft's `why`, shown once;
- find, source and check steps are given the statement, limits and done-whens, nothing the person supplied;
- the finder's plan had blanks ("[profile target role]") and its searches filled them from wherever they could reach, then reported matches to "the profile".

The fail mode: **a step runs without something it depends on, and the model fills the gap with a guess that looks like a result.** Two guards landed first (a plan with blanks runs no search and says what it needs; codex runs can't reach the operator's apps). They stop the guess. They don't get the missing thing into the notebook.

## Decision

**A notebook records what it depends on from you (`Notebook.given`), and its steps wait while any of it is missing.**

- Each is `{ key, label, link?, text?, state, why? }` with `state` one of `missing`, `given`, `skipped`. At most four.
- **Where they come from:** the drafter's `needs` (things the request refers to but doesn't contain; never their contents), and a find step whose plan says it needs something (`KeeperOutcome.needs` → `addGiven`).
- **The gate:** `startNotebookStep`, `searchAgain` and `startNotebookPipeline` refuse while one is `missing` (`givenWaitingReason`). Step cards aren't offered. The page asks at the top with a paste box and **Go on without it**; the conversation's greeting asks instead of offering Start.
- **`given`:** the pasted text (20 to 12,000 characters) goes to every step through the one place that builds their brief (`notebookBrief` → `givenBrief`) and to the writer, framed as all they know of it.
- **`skipped`:** a recorded choice. Steps are told it was NOT given and must not assume it or claim a match to it; the page says results aren't matched to it. A later request for the same thing doesn't reopen the ask.
- **The request is kept** as typed (`Notebook.asked`), so its links survive the drafter's rewrite; `notebookGivenLinks` reads it.
- Both are setup, not content: **Run it again** carries them.

## Alternatives

- **Read the page for them** (fetch the link, store what comes back). Rejected for now: a blocked site returns a sign-in wall, and storing that as "the profile" is the same failure in a new place. Asking is certain. A reader that can show it read the real thing could fill `given` later.
- **Put the text in the statement or a limit.** They are clipped (500 and 80 characters) and read as instructions, not source material.
- **Reuse `about`** (who a meeting notebook is about). It is filled by research with a page per fact; this is the person's own material with no page behind it, and it must gate steps, which `about` doesn't.
- **Let it run and label the results unverified.** That is what happened: the label was a clause nobody saw, and the results looked like matches.

## Consequences

- A notebook that depends on something of yours costs one paste before it does any work. One that doesn't is unchanged (`given` absent).
- The brief every find, source and check agent reads can now carry up to 8,000 characters per given thing.
- A drafter that names a need the notebook doesn't really have blocks its start until you choose **Go on without it** or remove it under Edit. The drafter is told needs are rare and what is not one (who a meeting is about, anything a search can find).
- Notebooks made before this have no `asked` or `given`; a find step that needs something adds the ask when it runs.
