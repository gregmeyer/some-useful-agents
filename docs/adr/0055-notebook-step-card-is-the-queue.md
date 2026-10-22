# ADR-0055: A notebook step's card is its one queue

- Status: accepted
- Date: 2026-10-22
- Deciders: Greg Meyer

## Context

A notebook's steps can be moved on from two places: the header's buttons (Next step, Move on, Try
again, Search again) and the step cards sua posts in the notebook's conversation. Both called the
same functions, so the step state itself stayed right, but everything the user saw drifted:

- **The header never retired cards.** After the user pressed Next step on the page, the old
  "Start step 1" / "Continue" cards still waited for approval in the conversation, and failed when
  clicked later ("It has already moved on from that step").
- **The header wrote nothing to the thread.** It said what happened only as a page flash.
- **A refused start was hidden from the conversation.** A Continue whose next step couldn't start
  (no checks, an agent that can't do that step) marked the met step done anyway, said why only on
  the page, and left the conversation with nothing to approve.
- **sua's own step cards weren't tied to a step,** so a card could act on whichever step was current
  when it was clicked.
- **sua could describe the steps wrongly.** It didn't know which card was waiting, and called a step
  "failed" that the page showed as To do.

## Decision

1. **The live `notebook-step` card is the request.** A step has a live card when the card names the
   current step and its status, and nothing is running. A paused step always has one: Continue, or
   Move on + Try again, or Start.
2. **The header acts through it.** Its buttons claim the live card (or add one, already claimed), run
   it through the same path as approving it in the conversation, and flash the card's own result. The
   card records `from: 'notebook'`.
3. **Cards are reconciled whenever the steps change:**
   - Triggers: after a card or header action, when a step's run ends, when steps are set or edited,
     on decide, narrow and status changes, and when the notebook page is opened.
   - A card that no longer applies is skipped with `skippedBy: 'notebook'` and a `skipReason`. So is
     an older card that asks the same as a newer one.
   - A missing card is added, unless the same card already failed or the user skipped it.
4. **sua's step cards are pinned** (`STEP`, `WAS`) when they're proposed. sua proposes none while a
   step runs, and none that's already waiting. A reply supersedes other proposed cards, not step
   cards.
5. **A refused Continue leaves the step met.** The met step is marked done only once the next step's
   checks pass.
6. **sua's notebook context includes `stepNow`:** the current step, whether it's running, and the
   card waiting on the operator.

## Consequences

- Header presses now leave a trail in the conversation, one card each. That's intended: it's the same
  record a card click leaves.
- Opening an older notebook can retire stale cards and add one for the current step.
- Ask-a-person questions (`human_questions`) were the other candidate queue. They weren't used because
  they belong to a run's node and resume that run; a step's pause isn't part of a run.
