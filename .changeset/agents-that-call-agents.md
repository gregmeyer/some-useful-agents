---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Make it visible that agents can run other agents.

sua has composed agents since `agent-invoke` shipped, and people are using it: on a 120-agent
install, seven agents call others, one orchestrates three of them, and one picks its callee at run
time from an input. sua's own Build-from-goal is a multi-agent system — `goal-surveyor`, then one
`agent-drafter` per fragment in parallel each behind a critic, then `dashboard-designer`.

None of that was visible. Every surface described composition as a *node type*: `agent-invoke` is
entry four of seven in the flow-control reference, and the only agent-to-agent affordance anywhere
in the UI was a "used by N" badge on the list. You had to already know the capability existed to
find it.

**Agent detail gains an "Agent calls" section** — what this agent invokes and what invokes it, each
linked, with the node doing the calling. A target chosen at run time is shown as "chosen at run
time" instead of a dead link to a template string; one pointing at an agent that no longer exists is
badged `missing`. Agents that neither call nor are called get no section, so the page doesn't assert
a capability it isn't using.

**The agents list gains a "calls N" badge** (the outbound half of "used by N") and a **Calls other
agents (N)** chip that narrows to exactly those agents. The count is scoped to the current tab and
search so the number predicts what clicking it returns.

**Adding a node offers "Call another agent."** The quick-start patterns are where someone is shown
what nodes are *for*, and composition was missing from them — reachable only by scrolling the tool
dropdown far enough to notice agents were listed in it. The pattern is hidden when there is nobody
to call, so a fresh install is never shown a dead button.

Under the hood this adds `lib/agent-graph.ts`, which builds the whole call graph in one pass. The
list previously called `getAgentInvokers` once per agent, and each of those rescanned every agent —
about 14,000 node visits per page load on a 120-agent store, to render some badges. The new helper
also answers the outbound direction, which the store method could not.
