---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

sua can build a helper agent and wire it into the agent that needs it, on one card.

When sua builds an agent for another agent (agent-builder with FOR_AGENT), the builder keeps it to one job with clear inputs. sua then works out where the agent should call it, and offers a single "Add it and wire it in" card. The card shows what the helper does, the change to the agent in plain words, and the diff. Approving it turns the helper on (marked "Helper for <agent>") and saves the agent with the new step. If saving fails, the helper is put back as a draft. Helpers are ordinary agents that other agents can call too.
