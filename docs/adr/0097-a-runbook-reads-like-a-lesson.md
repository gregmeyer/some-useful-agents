# 0097. A runbook reads like a lesson

- Status: accepted
- Date: 2026-11-21

## Context

The Runbook page (ADR-0094) laid a runbook out like a recipe, but it still opened like research. Its first part was the answer with "How sure: CDC, FDA…", what to have ready was a paragraph, and nothing closed it off. Training and recipe formats do it differently:
- **Carpentries lessons** open with an overview of questions and objectives and end with key points.
- **Microsoft Learn modules** state learning objectives and prerequisites first, put a knowledge check second to last, and end with a summary.
- **Google Codelabs** list "What you'll learn", time each step, and keep an outline of where you are.
- **Recipe apps** list what you'll need, can show one step at a time, and keep your place.
- **Checklist research** finds that people lose their place after an interruption.

## Decision

- **A runbook's answer can carry a `lesson`:**
  - goals: what you'll be able to do;
  - needs: one item each;
  - done: how you know you're finished;
  - key points;
  - what's next;
  - a self-check of questions with their answers.

  Steps carry a `phase`. All of it is in plain words with no facts of its own: a fact lives in a step and cites there.
- **The Runbook page, in order:**
  1. **What you'll make**: the outcome in a sentence and the goals, beside **At a glance**;
  2. **What you'll need**: a box to tick for each item, kept in this browser;
  3. **The steps**;
  4. **If something goes wrong**;
  5. **Finish**: you're done when…, the key points, what's next, and a self-check with its answers folded;
  6. **How sua knows this**, folded: the answer and how sure, why it's done this way, what it rests on, its sources, the evidence and the research.
- **The research is folded, not removed.** It is still there on the page, and the brief prints it, with the self-check's answers shown.
- **One component, `RunbookLesson`** (`part`: opening, needs, finish), draws the lesson on the page and in the brief.
- **A runbook written before lessons still lays out.** The opening falls back to its answer, what you'll need comes from its "What to have ready" part split into items (`runbookNeeds`), and Finish is left out. **Write again** adds the rest.
- **A notebook that picked the Runbook page follows it as it is now** (`notebookLayoutOf`). Improvements reach it without picking it again. A page changed from it no longer says "runbook" and keeps its own layout.

## Consequences

- A runbook reads as something to learn and do, start to finish. The evidence is one press away.
- A picked Runbook page no longer keeps a copy of the layout it was picked with.
- Phases, a progress bar, an outline of the steps, and a one-step-at-a-time mode come next, on the same data.
