# ADR-0051: A new helper agent and the call to it are approved on one card

- Status: accepted
- Date: 2026-10-11
- Deciders: Greg Meyer

## Context

When an agent couldn't do part of a job, sua's only way to change it was a fix: agent-analyzer
rewrote that agent's YAML and an `agent-editor` card replaced it. Agents grew prompts to do work
another agent could do, and a shared agent changed meaning for everyone who used it.

sua could already build an agent (`agent-builder`). It saved the agent as a draft and offered an
"Install draft" card, but nothing connected the new agent to the one that needed it. Wiring it in by
hand took a second, separate fix, and approving the two separately left a half state: a helper with
no caller, or a caller pointing at a draft.

## Decision

**Build and wire is one approval.**

1. **sua builds the helper.** It proposes `agent-builder` with `FOR_AGENT: <agent>`. The builder is
   told it's building a helper: one job, declared inputs, a JSON result line, and a description that
   starts "Helper for <agent>:". The helper is saved as a draft, as every build is, and there's no
   separate install card.
2. **sua works out where to call it.** The engine proposes agent-analyzer on `<agent>` with
   `COMPOSE_HELPER: <helper>` and a focus asking for one agent-invoke node that calls the helper
   (`proposeWiring`). It runs on its own when trust allows, because it only reads.
3. **One card.** When that analysis returns YAML that calls the helper, it becomes an
   `agent-compose` card instead of an `agent-editor` card. The card shows:
   - what the helper does and takes;
   - the change in plain words;
   - the diff.

   YAML that doesn't call the helper becomes an ordinary fix card.
4. **Approve does both, in order** (`executeAgentCompose`):
   - turn the helper on (active, marked "Helper for <agent>");
   - save the agent with the call, through the same path as a fix (version check, a copy for a
     shared agent in a notebook, the called-agent check from #855).

   If the save fails, the helper is put back as it was.

Helpers are ordinary agents in the agents list, so other agents can call them too. A route-handled
`agent-compose` is never proposed by triage directly, only by the engine, just as `agent-editor` is.

## Consequences

- An agent gains capability by calling another agent rather than by growing, and the helper stays
  reusable.
- Two LLM runs per build-and-wire (the builder and the wiring analysis), both before anything
  changes; only the card writes.
- A failed save leaves no half state. A helper later unwired by hand is still an ordinary agent that
  can be deleted (the "used by" guard covers agents that still call it).
- sua's rules for when to build a helper instead of fixing (the ladder: run, call, build and wire,
  edit) land separately in kernel.md.
