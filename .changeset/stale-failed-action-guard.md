---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Inbox: editing a failed agent unblocks retrying it from the thread.

The thread-level "same action already failed here" guard (hasMatchingFailedAction)
keyed only on agent id + inputs, so once an action failed it was blocked forever —
and for an agent that takes no inputs, every re-proposal looked identical, leaving
"revise the inputs or choose a different next step" impossible to follow even after
the operator fixed the agent.

The guard now clears once the target agent was edited after the failure: it
compares the agent's `updatedAt` against the failed action's end time, so fixing
the agent (a new version or a metadata edit, both bump `updatedAt`) makes the retry
a legitimately new action. Exposes `Agent.updatedAt` from the store, and the triage
kernel now tells triage to re-propose a run when the operator says they fixed the
agent.
