# 0095. A how-to starts on the Runbook page

- Status: accepted
- Date: 2026-11-21

## Context

The Runbook page (ADR-0094) lays a runbook out like a recipe. A new notebook made from "teach me how to make a PB&J sandwich" didn't get it: the page agent was told "answer for a question" and chose the Answer page. Once the notebook was written, the agent also composed its own page around a hero, so even a Runbook page didn't last. The writer only writes a runbook (how, what you'll see, if not) on the Runbook page, so the notebook got an ordinary answer.

## Decision

- A pure `asksForRunbook(notebook)` in core says whether a notebook writes a runbook. It's true when the notebook ends by writing the answer, isn't a briefing on a subject, and either asks to be taught or walked through something ("teach … to", "walk me through", "show me how", "how do I make / set up / fix …", "step by step", "runbook", "primer", "tutorial") or its write step is titled as a runbook. "How do I choose …" stays a question.
- A new notebook for which it is true gets the Runbook page at once, as `picked`, the way a briefing gets the Subject page. No page-agent run is spent on it.
- The writer writes a runbook on a Runbook page, or when it is true and the page is still the notebook's own.
- Once written, a Runbook page is not composed again: it already places each part by role.
- The page agent's instructions name the Runbook page, for "Let sua pick".

## Consequences

The choice is made by a word list, not a model, so it's cheap and testable but misses odd phrasings. Those still reach the page agent, which now knows about the page. Anyone can still pick another look on Edit.
