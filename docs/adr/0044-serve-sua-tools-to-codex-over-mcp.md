# ADR-0044: Serve sua tools to codex over the same per-attempt MCP endpoint, as config flags

- Status: accepted
- Date: 2026-09-30
- Deciders: Greg Meyer

## Context

ADR-0036 gave claude a node's `tools:` through a short-lived MCP endpoint passed with
`--mcp-config`. codex had no equivalent flag, so ADR-0035 skipped codex for any node that
declares tools, and goal nodes (which always do) fell through to the next provider. codex is
first in the operator's chain.

A spike on codex-cli 0.157.1 found:
- `codex exec -c key=value` overrides config per run, and codex supports streamable-HTTP MCP
  servers with a `bearer_token_env_var`.
- An MCP tool call in `exec` fails with "requires approval, but approval policy is never"
  unless the server sets `default_tools_approval_mode="approve"`.
- `-c mcp_servers.x=…` *merges* with the user's configured servers (they all start, including
  stdio ones launched via npx); `-c mcp_servers.<name>.enabled=false` switches one off.

## Decision

- codex is `supportsMcpTools`. For an attempt with tools, sua adds
  `-c mcp_servers.sua={url=…, bearer_token_env_var="SUA_TOOL_ENDPOINT_TOKEN",
  default_tools_approval_mode="approve"}` and sets that env var on the child only, so the token
  is never in argv / `ps`.
- Every other MCP server in the operator's codex config (`codex mcp list --json` with the
  child's PATH, ~60 ms, cached a minute) gets `-c mcp_servers.<name>.enabled=false`: only sua's
  endpoint loads, as with claude's `--strict-mcp-config`.
- **Not** `--ignore-user-config`: that would also drop the operator's model pin and other codex
  settings.
- The endpoint, allowlist, policy check, output cap and trace are the ones claude uses; codex's
  own `mcp_tool_call` events aren't recorded again.

## Consequences

- Nodes with `tools:` (and goal nodes) now run on codex instead of being skipped. Apple
  Foundation Models is the only CLI still skipped for tools.
- Live, gpt-5.5 through codex sometimes answers without calling its tools (once inventing a
  value). The goal framing asks it to use tools; this is model behaviour to watch, not wiring.
- If a future codex renames `default_tools_approval_mode`, every tool call fails with the
  approval error; the tests pin the flag shape, and the error surfaces on the node.
