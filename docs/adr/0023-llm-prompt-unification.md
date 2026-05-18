# ADR-0023: Unify `claude-code` and `llm-prompt` node types

## Status
Accepted

## Context

Two parallel call paths grew between agent YAML and the `claude` CLI:

1. **First-class node type** `type: 'claude-code'`, dispatched via `llm-invoker.ts`, which already branches on `provider: 'claude' | 'codex'`. Generalizes to other CLIs.
2. **Built-in tool** `claude-code` in `builtin-tools.ts`, marked in-source as *"Backcompat tool for v0.15 type:claude-code nodes"*. Hard-codes the `claude` binary. Does not generalize.

Codex was only reachable via path #1 (`type: claude-code` + `provider: codex`). The tool from path #2 had zero callers in any in-tree agent (grep `tool: claude-code` returned nothing). It existed as a UX device — the dashboard's tool picker dropdown used `'claude-code'` as a sentinel string that, when selected, made the form submit `type: claude-code` with a prompt.

The naming was also wrong. `type: claude-code` was being used as the *LLM-prompt shape*, not a binding to a specific CLI. The `provider:` field decides the CLI. Future contributors adding a new provider (Gemini, Aider) would be confused by the type name and tempted to register a new built-in tool per provider — exactly the parallel-path problem path #1 was designed to avoid.

## Decision

Resolve the asymmetry in five small PRs:

1. **Provider registry** (`packages/core/src/llm-providers.ts`) as single source of truth — display name, binary, version argv, prompt argv. `detectLlms()` and `invokeLlm()` iterate the registry.
2. **`type: 'llm-prompt'`** becomes the canonical spelling. `'claude-code'` is preserved indefinitely as a legacy alias — both load byte-identically. A helper `isLlmPromptType()` consolidates dispatch-site recognition.
3. **Delete the `claude-code` built-in tool** from `builtin-tools.ts`. Refactor the dashboard tool picker to use `'llm-prompt'` as its sentinel instead of `'claude-code'`. Validator emits a clear error for `tool: 'claude-code'` if anyone wrote it manually.
4. **Migrate example agents + docs** to the new spelling. Form/route emitters flip to `'llm-prompt'`. (This ADR + the eleven `agents/examples/*.yaml` updates ship in this PR.)
5. **Tool catalog surfaces installed providers** as derived, read-only entries — gives back the discoverability the deleted tool used to provide, without re-introducing a parallel call path.

Providers stay a property of `llm-prompt` (the `provider:` field), not separate node types or tools. Adding a third provider in the future is one entry in the registry plus a `LlmProvider` union member.

## Consequences

**Positive:**
- One shape, one dispatch path. Adding Gemini or Aider is mechanical: extend `PROVIDERS`, extend `LlmProvider`, extend `detectLlms()` (already iterates the registry).
- The node-type name (`llm-prompt`) accurately describes what the node does — runs an LLM prompt — instead of naming one specific CLI.
- Existing YAML keeps working forever; the alias has zero ongoing maintenance cost (one enum entry).
- The tool catalog stops advertising a tool whose only role was to act as a UX sentinel for the picker.

**Negative:**
- Two valid spellings for one concept (`claude-code` and `llm-prompt`) is permanent surface area. Mitigation: docs canonicalize on `llm-prompt`; the alias is mentioned once with a "prefer the new spelling" note.
- The dashboard tool picker's internal sentinel rename (`'claude-code'` → `'llm-prompt'`) touches ~6 dashboard files. Done in PR 3 alongside the tool deletion so the picker refactor and the tool removal land coherently.

## Alternatives considered

- **Status quo (asymmetric paths)** — rejected; would force the same choice again for every new provider.
- **Tool-per-provider** (`gemini`, `aider` as built-in tools alongside `claude-code`) — rejected; doubles down on the parallel path. Tool catalog discoverability is restored in PR 5 via a derived view instead.
- **Auto-rewrite YAML on disk** to canonical spelling — rejected; creates churn, breaks `git blame`, and the alias is free.
- **Internal canonical = `claude-code`, accept `llm-prompt` as alias** (the opposite direction) — rejected; keeps a CLI-specific name as the internal source of truth, which is exactly the problem this ADR is solving.

## References

- Plan: `~/.claude/plans/llm-prompt-unification.md`
- ADR-0016 (LlmSpawner abstraction) — established `provider:` as the CLI-selection axis; this ADR completes the rename half of that work.
- ADR-0019 (MCP servers first-class) — same pattern: surface what's available without coupling dispatch to the surface.
