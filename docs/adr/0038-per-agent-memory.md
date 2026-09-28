# ADR-0038: Per-agent memory, recalled into the prompt and edited with tools

- Status: accepted
- Date: 2026-09-27
- Deciders: Greg Meyer

## Context

Every run started from nothing. The per-agent state directory (`$STATE_DIR`) is a scratch
folder that one example uses; the only stores read back into prompts were planner memory
and inbox triage learnings, each with its own format. A goal agent (ADR-0037) that researched
something on Monday had to research it again on Tuesday.

## Decision

- **Opt-in, per agent.** `memory: true` or `memory: { recall: N }` (0–20, default 5) on the
  agent. Nothing is shared between agents; sharing goes through calling an agent as a tool.
- **One table** (`memories` in the run database) keyed by agent id, with the text, tags,
  pinned flag and source run. Similarity is the planner's Jaccard over `tokeniseGoal` tokens:
  no embeddings, no new dependency, good enough for hundreds of short notes per agent.
- **Auto-recall plus tools.** Once per run the executor builds a "What you remember" block
  (pinned notes, then the top-N by overlap with the inputs and node prompts/goals; 3 KB cap)
  and prepends it after templating, the same way as the behavior preamble. llm and goal
  nodes get `memory-save` / `memory-search` / `memory-forget`, scoped to the calling agent by
  context (no agent-id argument), under the normal policy and trace. The run records the
  recalled ids.
- **Memory tools are extras, not requirements.** A provider that can't call sua tools is not
  skipped for them (unlike a declared tool, ADR-0035): it still gets the recall block.
- **Redaction on save** of declared secret values and known credential shapes; 2000-char
  notes; 500 unpinned per agent, oldest pruned; deleted with the agent.
- **Temporal:** the worker gets `memoryRunId` and opens the store on the shared database; the
  in-process store never crosses the activity boundary.

## Alternatives rejected

- **The state directory.** Files a model can't search and a person can't see or edit in the
  dashboard; no redaction; nothing recalled unless each agent writes its own prompt glue.
- **Tools only (no auto-recall).** Models reliably forget to search before acting; the pinned
  and relevant notes should be in front of them from the first turn.
- **Recall only (no tools).** Then saving needs a fixed "extract facts" node on every agent,
  and the model can't correct a wrong note.
- **Embeddings.** A model download or API dependency for a few hundred notes per agent. The
  store keeps tokens per note, so a vector index can replace `search` later without a
  migration of the text.
- **Shared/global memory.** Unclear ownership and leak paths between agents with different
  secrets and trust. Agents-as-tools already gives controlled sharing.

## Consequences

- Recall quality is lexical: a note is recalled when it shares words with the run's inputs or
  prompt. Pinning covers always-needed facts; the tools cover the rest.
- The recall block costs up to 3 KB of prompt on every llm/goal node of a memory agent.
- Inbox triage learnings and conversation history (Phase D2/D3) will move onto the same block
  format instead of each keeping its own.
