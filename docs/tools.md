# Tools

A **tool** is a named, reusable unit of work a node invokes by reference. Each tool declares typed inputs and outputs; the executor validates both at save time (template paths) and run time (output framing).

```yaml
nodes:
  - id: fetch
    type: shell
    tool: http-get
    toolInputs:
      url: "https://api.example.com/items"
```

This page is the index. Each builtin, plus the MCP tool type, has its own page below.

## Implementation types

| Type | Runs as | Typical use |
|---|---|---|
| `shell` | Child process via `bash -c` | Calling shell utilities, local binaries, `curl`, `jq` |
| `claude-code` | `claude --print` (or Codex if provider=codex) | Prompting an LLM with run context |
| `builtin` | Direct in-process function call | Performance-critical things the runtime ships |
| `mcp` | Pooled MCP client → remote server | Integrating third-party MCP servers |

## Built-in tools

Ten tools ship with the runtime. Each is trusted (source: `builtin`) and bypasses the community-shell gate.

| Tool | Purpose |
|---|---|
| [`shell-exec`](tools/shell-exec.md) | Run an arbitrary shell command |
| [`claude-code`](tools/claude-code.md) | Run a Claude / Codex prompt |
| [`http-get`](tools/http-get.md) | HTTP GET with SSRF protection |
| [`http-post`](tools/http-post.md) | HTTP POST with SSRF protection |
| [`file-read`](tools/file-read.md) | Read a file within the project root |
| [`file-write`](tools/file-write.md) | Write a file within the project root |
| [`json-parse`](tools/json-parse.md) | Parse a JSON string into structured fields |
| [`json-path`](tools/json-path.md) | Extract a value from JSON via path |
| [`template`](tools/template.md) | Interpolate `{{inputs.X}}` into a template string |
| [`csv-to-chart-json`](tools/csv-to-chart-json.md) | Convert CSV into the JSON shape modern-graphics expects |

## MCP tools

Tools imported from an MCP server. See [`tools/mcp.md`](tools/mcp.md) for the type reference and [MCP servers](mcp.md) for the server-management flow.

## User tools

Declare your own in a YAML file under `tools/` (or via the dashboard). Schema:

```yaml
id: my-tool
name: My Tool
description: What it does
source: local

inputs:
  url: { type: string, required: true }
  timeout: { type: number, default: 10 }

outputs:
  status: { type: number }
  body: { type: string }
  result: { type: string }      # alias for primary output

implementation:
  type: shell
  command: |
    curl -m "$timeout" -w "%{http_code}" "$url"
```

Import with `sua tool import <file>` or via the dashboard.

## Input / output mapping

- **Inputs** come from the node's `toolInputs:` block (or `config:` for project defaults). Values flow through template resolution (`{{upstream.*}}`, `{{vars.*}}`) before reaching the tool.
- **Outputs** are extracted from the tool's result — JSON keys at the top level, or XML tags in the stdout. Downstream nodes reach them via `{{upstream.<nodeId>.<field>}}`.

Every tool also produces a synthetic `result` field (full stdout for shell, assistant text for claude-code) for v0.15 backcompat.

## `config` vs `toolInputs`

Tools can declare project-level `config:` defaults that every invocation inherits. Per-invocation `toolInputs:` overrides specific keys.

```yaml
# Tool YAML
id: http-get
implementation:
  type: builtin
  builtinName: http-get
config:
  timeout: 30
  headers: { User-Agent: "my-org" }

# Node YAML
- id: fetch
  tool: http-get
  toolInputs:
    url: "https://api.example.com"   # timeout + headers inherited from config
```

Config values can reference secrets (`{{secrets.NAME}}`) and global variables (`{{vars.NAME}}`).

## Related

- [Agents reference](agents.md) — how nodes reference tools
- [MCP servers](mcp.md) — importing third-party tools
- [Templating](templating.md) — `{{inputs.X}}`, `{{upstream.X.result}}` in tool args
- [Security model](SECURITY.md) — SSRF, path traversal, shell gate
