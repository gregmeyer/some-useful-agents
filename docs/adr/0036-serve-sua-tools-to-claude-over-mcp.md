# ADR-0036: Serve sua's tools to claude over a per-attempt MCP endpoint

- Status: accepted
- Date: 2026-09-27
- Deciders: Greg Meyer
- Supersedes: the claude native-tool mapping in ADR-0035 (its skip rule stands)

## Context

A node's `tools:` only really worked on OpenAI-compatible providers, where sua runs its
own tool loop. ADR-0035 stopped claude from answering tool-less by mapping two tools
(`web-fetch`, `web-scrape`) to claude's own `WebFetch` and skipping claude for anything
else. That meant the waterfall changed what an agent could do: the same node had
different tools depending on which provider answered, and most tools (integrations,
imported MCP tools, `http-get`, …) were out of reach on claude entirely.

claude can load MCP servers (`--mcp-config`, `--strict-mcp-config`), and sua already
has one provider-neutral executor (`buildToolExecutor`) that does the allowlist, policy
check, output cap and (since #671) `tool_calls` recording.

## Decision

For a claude attempt on a node that declares `tools:`, sua starts a short-lived MCP
endpoint in the process running the node and points claude at it.

- **Same executor.** The endpoint is a thin transport over the `buildToolExecutor` the
  HTTP loop uses (via one shared `buildAttemptToolSurface`), so the allowlist, policy
  check, cap and recording are identical for every provider. Tool schemas come from the
  same `resolveExposedToolDefs`, advertised with `fromJsonSchema`.
- **In-process, per attempt.** It runs where the node runs (dashboard, CLI, scheduler,
  Temporal worker), which already holds the tool, integration, secrets and variables
  stores. A stdio subprocess would have had to rebuild all of that, secrets included.
- **Locked down.** `127.0.0.1`, kernel-assigned port, a fresh 32-byte bearer token, and
  the same loopback Host/Origin checks as sua's MCP server. The config goes in a mode-0600
  temp file, never argv. It is closed and deleted when the attempt ends, however it ends.
- **Hermetic.** `--strict-mcp-config` so the operator's own claude MCP servers don't
  join agent runs, and `--allowedTools mcp__sua` (plus the node's own `allowedTools`).
- **No double counting.** claude's stream also reports `mcp__sua__*` calls; those are
  dropped from the native trace because the executor already recorded them as `sua`.
- The native mapping table (`CLAUDE_NATIVE_TOOL_EQUIVALENTS`) is removed. A CLI spawner
  now declares `supportsMcpTools`; codex and Apple Foundation Models still don't, so
  they keep being skipped (`tool_unavailable`) for nodes with tools.

## Consequences

- claude honours every declared tool; the waterfall no longer changes an agent's tools
  between claude and an OpenAI-compatible provider.
- One more moving part per tool-using claude attempt (a local HTTP listener for the
  attempt's lifetime). If it can't start, the attempt fails as `tool_unavailable` and
  the chain moves on.
- Policy enforcement (the stub `evaluatePolicy`) now has a single chokepoint covering
  both providers; making it real is the next step.
- Codex supports MCP too, but not verified under `exec -s read-only`; left for a spike.

## Alternatives considered

- **Keep extending the native mapping.** Rejected: only a handful of tools have a
  claude equivalent, and equivalents behave differently (WebFetch summarises bodies).
- **One long-lived shared endpoint per process.** Rejected for now: per-attempt keeps
  each token scoped to exactly one node's tools and needs no routing by run.
- **Anthropic SDK with native tool use.** Rejected: sua stays on the claude CLI transport.
