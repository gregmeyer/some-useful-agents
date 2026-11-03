# ADR-0069: A shortlist's write-up is kept as its answer

- Status: accepted
- Date: 2026-11-03
- Deciders: Greg Meyer
- Builds on: ADR-0064 (a page composed from what was written), ADR-0068 (a picked page still composes)

## Context

An answer notebook (a CD ladder) has a write step: the writer turns what was found into an answer, the findings it rests on, a rubric, steps and a diagram, and the page is composed around them. A shortlist (a job search with 23 roles) had no write step at all: find, check, narrow, decide. Nothing put the options into words. "Where it stands" was a formula (counts and the best by score), Head to head ruled facts without saying why one led, the learn evidence the finder gathered sat in Notes, and a decision recorded picks without reasons.

The fix is a write step for shortlists. The question was what it writes into: a new stored shape, or the answer's.

## Decision

1. **A new step shape, `writeup`, not a new payload.** The write-up (the lay of the land, the field in groups, the top three and why, what to do next, what's open) is written in the answer's JSON (`<answer>`, `cleanAnswer`, `sections` of kind table, steps and text) and stored as `nb.answer`. Everything downstream of the answer then works unchanged: the `answered` flag and `/notebook/answer/*` paths, `/notebook/answerSections`, findings and open questions, `delivers` ticking done-whens, what's new, corrections (struck findings and rows), `notebook-read`, the brief.
2. **What differs is the instructions, the words and the rewrites.** The writer gets the field ranked, with what failed, a few ruled out with why, each option's facet labels, and the pages that explain; its prompt asks for the story of the field rather than an answer. The step reads "write-up written", the button "Write up again", the readout "Write-up". A done-when worded as a list ("a final list of 10 recorded") is a written deliverable in a notebook with this step, given by the groups table. The write-up is written again on Update all, when you decide or change picks (so it says why these), and when a scheduled search finds new options.
3. **The shortlist page keeps its kind.** The ready-made shortlist page shows the write-up in place; a page sua drew is composed around it with its kind kept (as a picked page is, ADR-0068), never swapped for the Answer page.

## Consequences

- A notebook has one written answer: a step of shape `answer` and one of shape `writeup` in the same notebook would overwrite each other. The drafter lays in one or the other.
- The readout and labels tell the two apart by the step's shape, not by the payload; a notebook whose steps are later edited away from `writeup` reads its text as an answer again.
- A new stored shape can still come later if the write-up grows parts an answer can't hold; nothing written so far would need converting.
