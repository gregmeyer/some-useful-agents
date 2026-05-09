---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": minor
---

Tool-usage visibility on `/tools/:id` and the agent overview.

The `/tools/:id` detail page now has a "Used by" section listing every agent in the catalog that statically references this tool — sourced from the parse-time `agent.capabilities.tools_used` (covers explicit `tool:`, type-based desugaring, and node-level `allowedTools`). Empty state renders an explicit "no agents reference this tool yet" line.

Agent overview's tool badges now use the same canonical source, so badges include `allowedTools` entries that the previous inline derivation missed. Claude-code-native tools (`Bash`, `Edit`, `NotebookEdit`) render as plain badges instead of dead links to `/tools`.

This is the first slice of the tool-policies feature (PR A: visibility surface). The policy file shape, enforcement engine, and CLI/dashboard rule editor land in PRs B–D.
