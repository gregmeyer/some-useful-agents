# ADR-0061: A write step writes a meeting's talking points, grounded in the themes

- Status: accepted
- Date: 2026-10-25
- Deciders: Greg Meyer
- Builds on: ADR-0055 (one step queue), ADR-0058 (a notebook decides its page)

## Context

A meeting-prep notebook ended with a **decide** step, "Choose meeting talking points". Its dialog is the shortlist's: tick 3 of the themes found (shown as article cards with photos and "3/3 checked"), then Decide. Picking sources isn't having talking points: a talking point is something to raise, why it matters to them, and a question, drawn from several things they said.

## Decision

- **A new step kind, `write`.** sua's writer (`notebook-writer`, a system agent) reads what the notebook is for, who it's about (the profile step's facts) and the themes in the running, and writes the talking points: each a point to raise, why it matters to them, a question, and `from`, the ids of the themes it rests on. It also writes more questions and up to 3 things to watch for. They're kept on the notebook (`briefing_json`).
- **Grounded by id, not by the writer's words.** A point's quotes and sources are shown from the themes it names, never written by the model. Ids that aren't the notebook's own themes are dropped when it's kept (`cleanBriefing`), and a theme ruled out later drops off its point.
- **The agenda shows what was written** (`/notebook/talkingPoints`, `/notebook/questions`, `/notebook/watch`); before the step runs it shows the chosen themes as before. The brief follows.
- **Met with enough points** (`target`, else 3); **Write again →** on a done step writes them once more. It's about the notebook, not its options, so it isn't in the funnel.
- **The drafter and sua end a meeting notebook with `write`** instead of `decide`.

## Consequences

- One model call each time the step runs.
- Talking points can't be edited in place yet; say what to change in the notebook's conversation or run the step again.
- Existing meeting notebooks keep their decide step until changed (Edit → Talk: "write the talking points instead of choosing them").
