# ADR-0052: A node out of turns answers from what it read

- Status: accepted
- Date: 2026-10-15
- Deciders: Greg Meyer

## Context

A job-search notebook's find step ran `starter-research`, whose two gather nodes have `maxTurns: 10`. On a broad search (four job boards and careers sites, each posting opened and checked), both hit claude's `error_max_turns`. The spawner kept only the error string, so everything they had searched and read was lost, and the brief said "no results". Because both nodes are `optional`, the run still read **completed**, and nothing said two steps had died.

The run's tool calls showed where the turns went:
- six calls to claude's own `WebFetch`, all refused (the node has sua's `web-fetch`);
- a `Bash` curl, refused;
- ToolSearch calls to find tools;
- in another run, claude's `Agent` tool started a subagent that ran outside the node's turn and spend limits.

sua's `web-fetch` also refused the job boards' JSON APIs (unsupported content type), though one such call lists every posting with pay.

## Decision

**A node out of turns answers from what it read, and its turns go to work.**

1. **Wrap-up turn.** When claude stops with `error_max_turns`, the spawner resumes the same session (`--resume <session_id>`) once, with no tools (`--tools ""`, no MCP servers) and `--max-turns 2`. It asks for the answer in the task's format, saying what it couldn't cover. The node completes with a warning; if the wrap-up fails too, the node fails as before. Its tokens count toward the node. `onMaxTurns: fail` on a node opts out; goal nodes always opt out (out of turns is `budget_exhausted` for them).
2. **The budget is in the prompt.** A tool-using node is told how many turns it has and to answer in its last one.
3. **No turns on tools it can't use.** Claude's `Agent`/`Task`, its own `WebFetch` (when sua's is there) and `Bash` are passed as `--disallowedTools` unless the node lists them in `allowedTools`.
4. **web-fetch returns JSON** responses as content: public APIs (job boards' postings) are one call instead of many pages.
5. **Warnings survive.** A completed node now stores its `error` as a warning; it used to be dropped (including codex's "exited after answering" note and refused-tool warnings, and a fallback success overwrote it with a generic "Fallback X succeeded" note that the provider trail already shows). A completed run with failed optional steps says "Completed, but N steps didn't finish", and a notebook step's note names them.

## Consequences

- A search that runs long returns a partial, honest answer instead of nothing. It's marked as partial on the node, the run and the notebook step.
- The wrap-up costs one extra short call, only when a node ran out.
- A node that relied on claude's own `WebFetch`, `Bash` or subagents without listing them in `allowedTools` loses them. They were refused in print mode anyway, except subagents, which escaped the node's limits.
- Codex has no turn cap, so nothing changes for codex nodes.
- Breaking big searches into many small ones (a parallel `loop`, a find agent built as a fan-out) is the next step. This decision makes each of those small searches fail soft.
