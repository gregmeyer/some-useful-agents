---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

A notebook's step buttons and its conversation's step cards are one queue.

Pressing Next step, Move on, Try again or Search again on the notebook's page now uses the card that's waiting in the notebook's conversation, so the conversation says what happened ("✓ you, from the notebook") with the same words the page shows. Cards that no longer apply are retired with why ("The notebook has moved on from this."), each pause leaves one card, and a Continue that can't start the next step leaves the step met and says why in both places. sua's own step cards are tied to the step as it is when sua proposes them, a reply no longer clears the step's card, and sua is told which step card is waiting so it describes the steps as the page shows them.
