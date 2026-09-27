# ADR-0035: A node's declared tools skip providers that can't call them

- Status: accepted
- Date: 2026-09-26
- Deciders: Greg Meyer

## Context

`tools:` on an `llm-prompt` node lists sua tool ids the model may call. Only the
OpenAI-compatible HTTP path runs sua's tool loop. On the CLI providers the field was
ignored, on the theory (written into `starter-research`) that "the claude and codex
CLIs use their own web tools instead, so this works either way."

They didn't. `claude --print` is granted no tools unless `--allowedTools` names them,
and codex runs `exec -s read-only`. `starter-watch`'s `fetch` node ran on claude on
2026-09-13 and returned "the WebFetch tool call was blocked because permission to use
WebFetch has not been granted". The node exited 0, the run completed, and the judge
confidently answered NO about a page nobody read. All three first-run starters declare
`tools: [web-fetch]`.

## Decision

Declared tools are a requirement, not a hint:

1. Each CLI spawner may declare `nativeToolEquivalents` (sua id → its own tool name).
   Claude maps `web-fetch` and `web-scrape` to `WebFetch`, added to `--allowedTools`.
2. A provider that can't honour every declared tool is skipped before spawning, with a
   new fallback-worthy category `tool_unavailable`. If the whole chain is skipped the
   node fails with what to enable.
3. When claude refuses a tool call mid-run (still exit 0), the node keeps its answer
   and carries a warning naming the refused tool.

## Consequences

- A tools node never "succeeds" without its tools. On a codex-first chain the starters
  now run on the next provider that can fetch, not on codex.
- An install with only codex / Apple FM enabled now fails the starters loudly instead
  of producing confident answers about unread pages.
- Mappings stay deliberately narrow. `http-get` is unmapped because WebFetch summarises
  the body, which would change what a JSON-API node receives.
- This is a stopgap for giving every provider one tool surface (serving sua's tools to
  claude over `--mcp-config`); when that lands, claude honours every declared tool and
  the mapping table goes away.

## Alternatives considered

- **Fail any node whose run had a claude permission denial.** Rejected: the model often
  tries an ungranted tool and recovers with one it has; failing those would add false
  failures. Denials are surfaced as a warning instead.
- **Keep running tool-less and rely on `outputContract`.** Rejected: the failure is in
  the input the model never got, and the starters have no contract that would catch it.
