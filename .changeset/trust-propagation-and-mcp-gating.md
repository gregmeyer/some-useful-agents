---
"@some-useful-agents/cli": minor
"@some-useful-agents/core": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

**Security: chain trust propagation + MCP agent opt-in + threat model docs.** Closes `/cso` finding #4 and the MCP-scope portion of the remediation plan. Two behavior changes, one new default, and a new public doc.

### Behavior changes

- **MCP agents must opt in to be callable.** Only agents with `mcp: true` in their YAML are exposed via the MCP server's `list-agents` and `run-agent` tools. Non-exposed agents respond as "not found" so a compromised client cannot enumerate your full catalog. Existing example YAMLs (`hello-shell`, `hello-claude`, `dad-joke`) ship with `mcp: true` so the tutorial keeps working; new agents scaffolded by `sua init` default to `mcp: false` with a commented hint.
- **Community agent output flowing through chains is now treated as untrusted.**
  - Claude-code downstream prompts that consume `{{outputs.X.result}}` from a community-sourced X get a `[SECURITY NOTE]` prepended and the value wrapped in `BEGIN/END UNTRUSTED INPUT FROM X (source=community)` delimiters.
  - Shell downstream of a community upstream is **refused outright** with `UntrustedShellChainError`. This blocks the most direct RCE path (community output landing in a shell env var that a careless command could eval). Override via `executeChain`'s new `allowUntrustedShell: Set<agent-name>` option — per-agent, not global.
  - All chains, trusted or not, now receive `SUA_CHAIN_INPUT_TRUST=trusted|untrusted` in the downstream env so shell agents can branch.

### New documentation

- **`docs/SECURITY.md`** — full threat model: intended use, trust rings, layered MCP defenses, chain trust propagation, env filtering, cron cap, supply-chain posture. Equally explicit about what sua does NOT defend against (shell sandbox, secrets-store encryption strength, run-output secrets, Temporal history, remote MCP, DoS) so operators can evaluate fit without reading the code.
- **README** gains a four-sentence threat-model banner above the Quick start section, and the existing "Security notes" list is rewritten to reflect current reality.

### API changes (worth calling out for library consumers)

- `ChainOutput` (new exported type) — the outputs map value is now `{ result, exitCode, source }`. The resolver uses `source` to decide whether to wrap.
- `resolveTemplateTagged(template, outputs)` (new) — returns `{ text, upstreamSources: Set<AgentSource> }`.
- `executeChain(agents, provider, triggeredBy, options)` — fourth argument is now an options object `{ allowUntrustedShell?, pollInterval? }`. The previous positional `pollInterval` signature is replaced. No internal callers exist so this is a clean break; adjust any direct consumers.
- `UntrustedShellChainError` (new exported error) — thrown before the run starts.

### Migration

If you author YAML agents: add `mcp: true` to any agent you want reachable from Claude Desktop or another MCP client. The CLI commands (`sua agent run`, `sua schedule start`, etc.) are unaffected.

If you consume `@some-useful-agents/core` as a library: `executeChain`'s fourth arg became an options object, and the outputs map carries `source`. If you were passing a bare number for poll interval, wrap it as `{ pollInterval: n }`.
