# ADR-0083: How sure an answer is

- Status: accepted
- Date: 2026-11-19
- Deciders: Greg Meyer

## Context

An answer's confidence (high, medium, low) was the writer's word. ADR-0081 told the writer to judge it by how independent its sources are, and ADR-0082 told it which quotes weren't found on their pages, but nothing held it to that. The A2UI / AG-UI / CopilotKit answer still said "high": every source but one was a subject's own.

An answer also mixed what a source says with what the writer draws from it, in one list of findings. And it had nowhere to say that its sources disagree, so a disagreement was smoothed over or left out (SIFT: stop, and weigh what you have).

## Decision

**Code caps the confidence from the evidence, where it's shown.** `answerConfidence` (core, pure) takes the writer's word and caps it; it never raises it.

- **Fewer than two publishers outside its subjects** among what it cites: medium ("every source it cites is published by A2UI or CopilotKit themselves" / "only one publisher it cites is from outside them").
- **Its sources not traced yet**, in a notebook with a check step: medium.
- **No factual finding traced to a primary page**: medium.
- **Most factual findings' quotes not found**: low; **some not found**: medium.
- **Its sources disagree** (contradictions it noted): medium.
- **Where it applies:** only to what an answer rests on from pages (evidence). A shortlist's write-up, which cites options, keeps the writer's word.

The page shows the capped word ("Answer · fairly sure"), and after the writer's basis, **Why not higher:** with each cap that applies. sua's conversation and `notebook-read` report the same. The stored answer keeps the writer's word, so the cap follows the evidence as sources are traced or added, without writing again.

**Each finding says whether it's a fact or an interpretation.** The writer marks each finding `"kind": "fact"` (what a source says, which the trace checks) or `"interpretation"` (what it draws from them). An interpretation is tagged **Interpretation** in place of a trace. It doesn't count for or against the cap: tracing a quote can't check a judgement.

**An answer names where its sources disagree.** The writer lists up to 3 `contradictions`, each naming the sources on both sides; one with fewer than two sources isn't kept. They lead **Still open** after the ADR-0081 caution ("Sources disagree: …") and cap the confidence at medium.

## Consequences

- An answer can no longer be "sure" on its subjects' own pages, or on quotes that aren't on their pages. The page says why in plain words.
- The cap is computed each time the answer is shown (pure, from the entries), so it changes as Check traces sources or Find adds outside ones. The stored confidence is the writer's.
- Answers written before this have no finding kinds or contradictions. Their findings are treated as facts.
- An open question about a done-when doesn't cap the confidence yet; telling which open questions bear on a criterion would need the writer to say so.
