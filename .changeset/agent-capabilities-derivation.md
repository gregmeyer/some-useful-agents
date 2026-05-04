---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Derived agent capabilities at the parse boundary.

New `deriveCapabilities(agent: Agent): AgentCapabilities` in core. Computes a static, best-effort summary of what an agent uses and does — populated by `parseAgent` and `agent-store.rowToAgent` and exposed on `Agent.capabilities`.

```ts
{
  tools_used:        string[],   // shell-exec, claude-code, http-get, allowedTools entries…
  mcp_servers_used:  string[],   // extracted from mcp__server__tool naming
  side_effects:      ('sends_notifications' | 'writes_files' | 'posts_http')[],
  reads_external:    string[],   // URLs from toolInputs.url/endpoint, regex hits in command/prompt
}
```

Heuristic and conservative — an empty array means "couldn't statically prove," not "doesn't do X." Not a security boundary. Used by the planner-fronted agent-builder (PR A) for cross-agent composition decisions and by the upcoming preflight checks ("does this agent need MCP servers I haven't installed?"). Recomputed on every read; never persisted.
