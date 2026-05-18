---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Surface installed LLM providers on the `/tools` catalog page.

A new "LLM providers" section above the user / built-in tabs lists every entry in the provider registry with its installed status (resolved from `$PATH` at request time), version string, and "used by N agents" count. Counts walk every active agent's nodes, resolve each LLM-prompt node's effective provider (`node.provider ?? agent.provider ?? 'claude'`), and tally agents (not nodes) per provider — an agent with five Claude nodes counts once.

Cards are read-only — no invoke button. The intent is *discoverability*: it gives back what the deleted `claude-code` built-in tool used to provide (a visible entry on the tools page) without re-introducing a parallel call path. Providers that aren't on PATH render with a "not on PATH" badge and the install hint instead of a version.

Closes the LLM-prompt unification plan (PR 5 of 5). Adding a third provider in the future remains one entry in `PROVIDERS` from PR 1 — the catalog row appears automatically.
