# ADR-0057: A template can have a subject that changes each time

- Status: accepted
- Date: 2026-10-24
- Deciders: Greg Meyer
- Builds on: ADR-0053 (notebook templates)

## Context

Some templates are about someone or something new each time: meeting prep for a person or a company. Asking sua to notice the old name and swap it everywhere missed some, and a check that named the person kept the old one.

## Decision

A template can have a **subject**: `{ label, example }`, with `{subject}` in its texts wherever the example was named.

- **Saving.** Save as a template is a page, not a one-line form. You edit the texts there and say what changes. The swap is deterministic: the example as a whole phrase, any case, in the statement, limits, done-whens, checks, step titles, fact labels and title (`subjectOut`).
- **Starting.** `notebook-create` takes `SUBJECT`, and `notebookFromTemplate` fills every `{subject}` (`fillSubject`). A template with a subject refuses to start without one, so sua must ask; New notebook has a box for it beside Start.
- **Why not placeholders for everything.** The other limits (place, pay floor) still vary by sua's questions. One subject covers what was missed, without a form builder.

## Consequences

- Starting a meeting-prep notebook for someone new can no longer keep the last person's name in a check or limit.
- Checks were also clipped at 60 characters mid-word ("…not someone with a simila"). They now keep up to 120, cut on a word (`clipWords`).
