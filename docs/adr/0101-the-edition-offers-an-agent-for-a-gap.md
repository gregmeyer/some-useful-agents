# 0101. The edition offers an agent for a gap

- Status: accepted
- Date: 2026-11-22
- Supersedes: in [ADR-0076](0076-the-edition-follows-preferences.md), "New agents aren't drafted for the edition"

## Context

ADR-0076 kept Today's edition to preferences. Its review could suggest leaving an agent out, bringing one in, what leads, and a top item, but never a new agent. A board's review (ADR-0075) can draft one. So when the edition's goal named something none of your agents covers ("the weather, what to focus on, overnight email"), the edition could only say so. That breaks a rule we hold elsewhere: a review that names a gap offers an agent to fill it.

## Decision

- **The edition's review may suggest a draft**, as a board's does (`drafts: true` for `today`).
- **The edition's Ask box may offer one too**: a `draft` action with a purpose (12–200 characters), at most two per ask, and not one of your existing agents by name.
- **Taking it uses the same drafter, critic and single inbox approval as a board** (`draftForBoard`). Nothing is created as active, and nothing runs until you approve.
- **Approved, a drafted agent becomes active, runs once, and is added to the edition's "always show"** preference. The edition has no page to place it on. It appears once its first run has a result. If that run fails, it isn't there, and the run says why.
- **Declined, the drafts are deleted**, as on a board.
- **The edition still can't be arranged or saved as a page.**

## Consequences

- A goal for the edition can be met with an agent that doesn't exist yet, without leaving Pulse.
- The edition's preferences can now name an agent before its first result. `include` already allowed that: an agent with no result is simply not drawn.
