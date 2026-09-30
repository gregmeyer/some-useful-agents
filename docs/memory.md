# Agent memory

An agent with `memory:` on keeps notes between runs. It saves what is worth keeping (a fact it found, a preference you told it, a result it can reuse), and each later run starts with the notes that matter for that run.

```yaml
id: trip-scout
name: Trip scout
memory: true            # or: memory: { recall: 8 }
nodes:
  - id: plan
    type: goal
    goal: "Plan a weekend in {{inputs.CITY}}. Remember prices and opening hours you find."
    tools: [web-fetch]
```

## What a run gets

- **A recall block at the start.** Before the first model call, sua puts a short block in front of every llm and goal node's prompt:

  ```
  WHAT YOU REMEMBER (from earlier runs of this agent — use it, and keep it current with memory-save / memory-forget):
  - [a1b2c3d4] (pinned) The user wants answers in euros
  - [e5f6a7b8] Louvre tickets cost 22 euros (checked 2026-09)
  ```

  It holds every pinned note, then the notes most similar to the run's inputs and the node's prompt or goal (default 5, `memory: { recall: N }` up to 20; `recall: 0` gives pinned notes only). The block is capped at 3 KB, dropping the least relevant first. It is added after templating, so text in a note is never expanded as `{{…}}`.
- **Three tools** on its llm and goal nodes, added automatically:

  | Tool | Does |
  |---|---|
  | `memory-save` | `{ text, tags?, pinned? }`: saves a note and returns its id |
  | `memory-search` | `{ query, limit? }`: finds notes by similarity |
  | `memory-forget` | `{ id }`: deletes a note (use it when a note is wrong, then save the correction) |

  They only ever act on the calling agent's memory; there is no agent id argument. Tool policy and the tool trace apply to them like any other tool. A provider that can't call sua tools (Apple Foundation Models) still runs the node; it gets the recall block but can't save.

The run records which notes it was given (`recalledMemories` on the run), so you can see what influenced it.

## Scope and safety

- **Per agent.** Nothing is shared between agents. To share what an agent knows, call it as a tool (`agent:<id>`, see [agents-as-tools.md](agents-as-tools.md)).
- **Secrets are redacted on save.** The values of the node's declared `secrets:` and known credential shapes (API keys, tokens) are replaced before a note is stored.
- **Bounded.** A note is at most 2000 characters; an agent keeps at most 500 unpinned notes (the oldest are dropped as new ones are saved). Pinned notes are never dropped automatically.
- **Deleted with the agent.** Deleting an agent deletes its notes.

Notes live in the same SQLite database as runs (`data/runs.db`, table `memories`), so Temporal workers share them.

## See and change what an agent remembers

- **Dashboard:** the agent's Overview has a **Memory** section: every note, with Pin / Unpin and Forget.
- **Terminal:**

  ```bash
  sua memory list trip-scout
  sua memory search trip-scout louvre tickets
  sua memory pin trip-scout a1b2c3d4        # --off to unpin
  sua memory forget trip-scout a1b2c3d4     # or --all
  ```

## Memory vs `$STATE_DIR`

The per-agent state directory ([agents.md](agents.md#persistent-state--state_dir-and-state)) is for files your nodes read and write themselves (diffs, caches). Memory is for things the model should know next time: it is searched, recalled into the prompt, and visible and editable in the dashboard.

Design notes: [ADR-0038](adr/0038-per-agent-memory.md).
