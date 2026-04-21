# @some-useful-agents/core

Core library for some-useful-agents. Types, schemas, stores, DAG executor, tool registry, secrets management, and template resolution.

## What's inside

- **Agent types + Zod schemas** — `Agent`, `AgentNode`, `AgentSignal`, `SignalTemplate`, `NodeType` (shell, claude-code, conditional, switch, loop, agent-invoke, branch, end, break)
- **DAG executor** — topological walk with flow control, onlyIf conditional edges, nested agent-invoke, loop iteration, AbortSignal cancellation
- **LlmSpawner** — multi-provider abstraction for Claude and Codex CLIs with stream-json progress tracking
- **Tool system** — 9 built-in tools + `ToolStore` for user-defined tools, with path traversal protection on file-read/file-write
- **Stores** — `AgentStore` (versioned DAGs), `RunStore` (paginated queries), `ToolStore` (SQLite via `node:sqlite`)
- **Secrets** — `EncryptedFileStore` with AES-256-GCM, scrypt KDF (OWASP 2024 params), passphrase + legacy-fallback modes
- **Template resolution** — `{{upstream.X.result}}`, `{{inputs.NAME}}`, `{{vars.NAME}}`, `$UPSTREAM_X_RESULT`
- **Signal system** — `AgentSignal` with display templates (metric, text-headline, table, status, time-series, image, text-image, media) and field mapping for the Pulse dashboard
- **Input security** — sensitive env-var deny-list prevents LD_PRELOAD/PATH/NODE_OPTIONS injection via agent inputs

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
