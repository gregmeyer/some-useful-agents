---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Tool policies are enforced: allow/deny rules for every tool your agents call.

Rules in `data/.sua/policies.json` can allow or deny a tool by id (globs work), by what it touches (URL, absolute file path, or command, glob-matched), and by the agent's source tier (`examples`, `local`, `community`). The last matching rule wins, and `defaultAction` covers everything else. sua checks the rules before every sua tool call: tool nodes, plus every tool a model calls on any provider, including the Temporal worker. A blocked tool node fails as "Blocked by tool policy" and isn't retried. A blocked model tool call returns the reason to the model and shows as an error in the run's tool-call list.

A policy file that exists but is invalid now fails closed: every tool call is denied until it's fixed. Before this release nothing was enforced; the check always allowed.

New `sua policy show | check <tool> [resource] | validate` lets you inspect and test rules before a run hits them. `check` exits 0 for allow and 1 for deny.

Two fixes to the tool-node check. It now judges resolved inputs, so a templated `{{inputs.URL}}` can no longer slip past a URL rule. And a denial is handled as a node failure instead of escaping it. See docs/tool-policies.md.

Also fixes `AgentStore.fromHandle` never setting `dataRoot`. The CLI (`sua agent run`, `workflow run`, replay) and the scheduler open their stores that way, so their runs had no data root: no per-agent state directory (`{{state}}` resolved empty), and they would have skipped the tool policy. `dataRoot` is now derived from the shared connection's database file.
