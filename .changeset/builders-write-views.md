---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

New agents get a view, and "make this tile better" in a conversation starts a redesign.

The agents that write agents (the drafter, agent-builder, build-planner, and sua's fixes) now describe results with an A2UI `view:` bound to the agent's declared `outputs:`, instead of an `outputWidget` (kept for capture-image and diff-apply actions). They get a VIEWS guide built from the component catalog, and the build critic sends back a view that binds an output the agent doesn't declare. In a conversation, asking for an agent to look better or different starts sua's view designer (a `view-redesign` action, no approval needed since nothing changes until you use the proposal) and replies with the link to compare.
