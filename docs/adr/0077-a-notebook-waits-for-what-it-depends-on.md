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
- **`given`:** the pasted text (20 to 40,000 characters) is kept. Steps receive sua's reading of it (below) through the one place that builds their brief (`notebookBrief` → `givenBrief` → `givenForStep`) and the writer through the same helper, framed as all they know of it. With no reading, they receive the first 8,000 characters as pasted.
- **The reading (`given[].read`, added after the first use):** the raw paste was a poor input. A copied profile page is mostly clutter, and what matters often sat past the 8,000 characters steps were given. So a paste is read once by a small agent (`notebook-given-reader`) into `{ summary, facts: [{ label, value, quote }] }`, at most 30 facts. Code keeps a fact only when its quote is in the paste (compared by letters and digits), so the reading is held to the same rule as everything else here: nothing the person didn't give. Steps wait while it's being read (`givenReadingReason`); a reading that fails doesn't block them. The page shows the reading; a correction is the person's own line (`byYou`), which needs no quote.
- **`skipped`:** a recorded choice. Steps are told it was NOT given and must not assume it or claim a match to it; the page says results aren't matched to it. A later request for the same thing doesn't reopen the ask.
- **The request is kept** as typed (`Notebook.asked`), so its links survive the drafter's rewrite; `notebookGivenLinks` reads it.
- Both are setup, not content: **Run it again** carries them.

**A file is a way to fill the box, not a second store.** A PDF chosen beside a paste box is turned into text (`POST /notebooks/given-file`, `unpdf`) and put in the box; the box's own form stores it. So there is one path in (text), the person sees what will be kept, and no file is held. A scan yields nothing and says so: reading text off pictures would be a guess at the person's own material.

## Alternatives

- **Read the page for them** (fetch the link, store what comes back). Rejected for now: a blocked site returns a sign-in wall, and storing that as "the profile" is the same failure in a new place. Asking is certain. A reader that can show it read the real thing could fill `given` later.
- **Put the text in the statement or a limit.** They are clipped (500 and 80 characters) and read as instructions, not source material.
- **Reuse `about`** (who a meeting notebook is about). It is filled by research with a page per fact; this is the person's own material with no page behind it, and it must gate steps, which `about` doesn't.
- **Let it run and label the results unverified.** That is what happened: the label was a clause nobody saw, and the results looked like matches.

## Consequences

- A notebook that depends on something of yours costs one paste before it does any work. One that doesn't is unchanged (`given` absent).
- The brief every find, source and check agent reads carries the reading of each given thing (a few thousand characters at most), or up to 8,000 characters of the paste when there is none.
- A paste costs one short model run before the waiting step starts. Steps trust the reading: a fact the reader missed is not seen by them until the person adds it under Edit, which is why the page shows the reading.
- A drafter that names a need the notebook doesn't really have blocks its start until you choose **Go on without it** or remove it under Edit. The drafter is told needs are rare and what is not one (who a meeting is about, anything a search can find).
- Notebooks made before this have no `asked` or `given`; a find step that needs something adds the ask when it runs.
