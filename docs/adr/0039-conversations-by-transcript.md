# ADR-0039: Conversations replay a budgeted transcript; each turn is a run

- Status: accepted (storage superseded by ADR-0048)
- Date: 2026-09-28
- Deciders: Greg Meyer

## Context

You couldn't talk to an agent and follow up. The only conversation in sua was an inbox
triage thread, which replays the whole thread as text with no budget. Claude
(`--resume` / `--session-id`) and codex (`exec resume`) keep sessions of their own, but sua
ignored them, and OpenAI-compatible models and Apple Foundation Models have no server-side
session at all.

## Decision

- **A session is a list of turns; each turn is an ordinary run.** `sessions` and
  `session_turns` in the run database. A user turn is recorded against a pre-generated run
  id before the run starts; the agent turn (the run's result, or its error marked failed) is
  added when it finishes, or later by `reconcileSession` when nobody waited for it (the
  dashboard, a Temporal worker, an interrupted CLI).
- **Continuity by transcript.** The earlier turns go into a "conversation so far" block,
  most recent kept within 8 KB, oldest first, 2000 chars per turn. The executor prepends it
  to llm and goal prompts after template substitution, after behaviors and memory
  (`DagExecuteOptions.conversationPreamble`, forwarded to Temporal's `runDagActivity`).
- **The message fills one input:** `chat.input`, else the only required string input, else
  the only string input; otherwise a `NotConversationalError` that says what to add.
- **Three surfaces, one core API** (`prepareAgentTurn` / `runAgentTurn` /
  `completeAgentTurn`): `sua agent chat`, MCP `run-agent` with `message` + `sessionId`, and
  a Chat tab on the agent page.

## Alternatives rejected

- **Native provider sessions** (claude `--resume`, codex `exec resume`). Only two of the
  four provider kinds have them, a turn can fall back to a different provider mid-thread,
  a multi-node agent has one session per node, and the state would be invisible to sua.
  They are worth adding later as an optimisation for single-node claude agents (they keep
  tool results between turns without replaying text), on top of this model.
- **A separate "chat agent" type.** Every agent with a text input can already take a
  message; a new type would split the catalog.
- **Unbounded replay** (what triage does). Long threads would crowd out the prompt and cost
  tokens on every turn. Phase D3 moves triage onto this builder.

## Consequences

- The agent sees what was said, not what its tools returned in earlier turns. Facts that
  must outlast a thread belong in [memory](../memory.md) (ADR-0038).
- Each turn costs up to 8 KB of extra prompt per llm/goal node.
- Runs from a chat look like any other run (`triggeredBy` cli / mcp / dashboard); the link is
  from the turn to the run, not the other way round.
