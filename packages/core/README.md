# @some-useful-agents/core

Core library for some-useful-agents. Provides types, schemas, stores, the DAG executor, tool registry, secrets management, and template resolution.

## What's inside

- **Agent types + Zod schemas** — `Agent`, `AgentNode`, `NodeType` (shell, claude-code, conditional, switch, loop, agent-invoke, branch, end, break)
- **DAG executor** — topological walk with flow control, onlyIf conditional edges, nested agent-invoke, loop iteration
- **Tool system** — 9 built-in tools + `ToolStore` for user-defined tools
- **Stores** — `AgentStore`, `RunStore`, `ToolStore` (SQLite via `node:sqlite`)
- **Secrets** — `EncryptedFileStore` with scrypt-derived key, passphrase + legacy-fallback modes
- **Template resolution** — `{{upstream.X.result}}`, `{{inputs.NAME}}`, `$UPSTREAM_X_RESULT`

## Install

```bash
npm install @some-useful-agents/core
```

## Usage

```typescript
import { AgentStore, RunStore, executeAgentDag, listBuiltinTools } from '@some-useful-agents/core';
```

See the [main repo README](https://github.com/gregmeyer/some-useful-agents) for full documentation.

## License

MIT
