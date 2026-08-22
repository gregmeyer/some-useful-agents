---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

`sua agent run` and `sua agent list` now reach v2 DAG agents.

`sua agent run <id>` reported "not found" for any v2 agent — even one that
`sua workflow run <id>` executed happily — because the `agent` verbs went
through `loadAgents`, the V1 loader, which silently skips every v2 file. The
failure then pointed at `sua agent list`, which for the same reason could never
list the agent you were looking for.

`agent run` now falls through to the v2 store and executes on the same path as
`workflow run`, and `agent list` shows v1 and v2 together with a `Model` column.
`sua workflow` is unchanged and keeps the verbs that have no `agent` equivalent
(import, export, replay, logs, show). Both verbs now share one execution path
instead of two copies of the store wiring. See ADR-0032.

Also: `-i` now works as the short form of `--input` on both verbs. The docs had
been showing `-i NAME=value` for a while, but only `--input` was ever wired up.
