# @some-useful-agents/core

Core library for some-useful-agents. Types, schemas, stores, DAG executor, tool registry, secrets management, and template resolution.

## What's inside

- **Agent types + Zod schemas** — `Agent`, `AgentNode`, `AgentSignal`, `SignalTemplate`, `NodeType` (shell, llm-prompt — with `claude-code` accepted as an alias — goal, ask, conditional, switch, loop, agent-invoke, branch, end, break)
- **DAG executor** — topological walk with flow control, onlyIf conditional edges, nested agent-invoke, loop iteration, AbortSignal cancellation, MCP server enable/disable gate
- **Providers** — Claude and Codex CLIs, OpenAI-compatible endpoints (with a native tool-calling loop), and Apple Foundation Models, in a fallback waterfall; Claude and Codex reach a node's tools over a per-attempt local MCP endpoint
- **Tool system** — 10 built-in tools + `ToolStore` for user-defined tools + `type: mcp` implementation for MCP-imported tools
- **MCP integration** — `McpServerConfig`, `parseMcpServersBlob` (Claude-Desktop / Cursor / bare-map shapes), pooled MCP client (stdio + streamable-HTTP)
- **Output widgets** — `OutputWidgetSchema` with 5 types (raw, key-value, diff-apply, dashboard, **ai-template**)
- **Template generators** — `TemplateGenerator` interface + `claudeTemplateGenerator` + `registerTemplateGenerator()` for codex/gemini/etc.
- **HTML sanitizer** — `sanitizeHtml` (tag/attr allowlist, zero deps) + `substitutePlaceholders` for safe rendering of AI-generated templates
- **Stores** — `AgentStore` (versioned DAGs), `RunStore` (paginated queries), `ToolStore` (tools + `mcp_servers` table via `node:sqlite`)
- **Secrets** — `EncryptedFileStore` with AES-256-GCM, scrypt KDF (OWASP 2024 params), passphrase + legacy-fallback modes
- **Template resolution** — `{{upstream.X.result}}`, `{{inputs.NAME}}`, `{{vars.NAME}}`, `$UPSTREAM_X_RESULT`
- **Signal system** — `AgentSignal` with 13 display templates including `widget` (mirrors the agent's own outputWidget)
- **A2UI views** — `view:` schema, the sua component catalog and `validateViewComponents` (the A2UI message processor in strict mode, via `@a2ui/web_core`), `resolveAgentView`, `buildViewDataModel`, `viewToMessages`
- **Goal agents, agents as tools, ask-a-person** — `goal` nodes with budgets, `agent:<id>` tools, `ask` nodes / `ask-human` tool with `HumanQuestionStore` and run resume
- **Memory and sessions** — `MemoryStore` (per-agent, recall + tools), `SessionStore` / `runAgentTurn` for conversations
- **Cost and spend limits** — per-attempt usage capture, run roll-ups, `usageSummary`, `spendLimit` enforcement
- **Tool policies** — `evaluatePolicy`, `resolvePolicyDocument`, and the writer (`savePolicyDocument`, `savePolicyText`, `restorePolicyBackup`)
- **Webhooks** — `WebhookStore`, input mapping and filters, GitHub signature checks
- **Example agents** — 40+ bundled under `examples/`
- **Input security** — sensitive env-var deny-list prevents LD_PRELOAD/PATH/NODE_OPTIONS injection via agent inputs
- **SSRF protection** — `assertSafeUrl` validates DNS-resolved IPs against private/loopback/metadata ranges

## Install

```bash
npm install @some-useful-agents/core
```

## Usage

```typescript
import { AgentStore, RunStore, executeAgentDag, listBuiltinTools } from '@some-useful-agents/core';
import type { Agent, AgentSignal, SignalTemplate } from '@some-useful-agents/core';
```

See the [main repo README](https://github.com/gregmeyer/some-useful-agents) for full documentation.

## License

MIT
