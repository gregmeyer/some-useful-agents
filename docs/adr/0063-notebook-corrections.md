# ADR-0063: A correction is worked out by a model, and followed through the notebook by code

- Status: accepted
- Date: 2026-10-30
- Deciders: Greg Meyer
- Builds on: ADR-0061 (the write step), ADR-0062 (settling who they are)

## Context

When you correct a notebook in its conversation ("she's COO now, not VP Ops", "that point is wrong"), nothing followed the change through:
- Triage could only add things, or correct one option's facts.
- The talking points, questions, check results and picks that rested on the old value stayed as they were.
- A fact you corrected was changed back the next time research looked.

## Decision

- **A system agent works out the change; it changes nothing itself.**
  - Triage hands the correction over (`notebook-correct`, a read, auto-run) in your words.
  - `notebook-correction` reads the notebook as parts, each with an id, a role (evidence, judgment, rule) and what it rests on.
  - It returns the smallest change meant (`semantic_delta`), what that change touches (`impact`: keep, reevaluate, invalidate), or one question when it can't tell.
- **Code checks it and follows the links.** `checkCorrection` (lib/notebook-correction.ts):
  - **checks the ids:** a target the notebook doesn't have is a question, never a guess, and impact on unknown ids is dropped;
  - **follows what follows by the notebook's own links:**
    - an option's fact reaches its check results, rule-out and pick, and whatever cites the option;
    - a check reaches the options checked against it;
    - a fact about them reaches what sua wrote that says the old value;
  - **protects evidence:** evidence is never invalidated by another part's change; at most it's looked at again.
- **A card, applied on your word.**
  - The card (`notebook-correct-apply`) lists the change, what it rewrites, takes out or looks at again, and how much it keeps.
  - It stores the checked correction and the words of each part it touches. Applying acts on the parts as they are now, found by those words.
- **A fact you correct stays yours.**
  - `correctAbout` settles the fact as yours, and remembers the values you said it isn't (`settled.wrong`).
  - Research doesn't change the fact back (`mergeAbout`), and sources that only disagree on what you said it isn't don't raise it again.
  - An empty value means the fact is wrong: it goes, and isn't learned again.
- **Rewrites stay small.**
  - Talking points that rest on the old value are struck and written again in their places, one writer run for all of them. The others are kept (`strikePoints`).
  - Questions that rest on it come out.
  - Findings and plan items that are wrong come out and are struck (`struck` on answers and plans, like talking points). One that should say something else has the answer or plan written again.

## Consequences

- One small model call per correction, only in a notebook's conversation.
- The first version applies corrections to facts about who the notebook is about, and to what sua wrote. For option facts, limits, checks and done-whens, the agent and the checks already work out the impact, but sua only says what it would touch. Applying them (rechecking just the affected options) comes next.
- Settled-by-you now holds for every fact about them, not just their company, including facts settled with the "Not settled" buttons.
