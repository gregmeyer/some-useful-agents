---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Rewire a multi-node agent on the DAG canvas instead of through checkboxes.

Changing how nodes connect meant opening each node's edit form, ticking `dependsOn` boxes, and
holding the shape of the graph in your head — with every node you touched producing its own new
version. The agent-detail DAG now has an **Edit wiring** mode: drag one node onto another to make
the second depend on the first (or click source then target, which also works by keyboard and on
touch), and click an edge to remove it. **Save wiring** commits the whole rearrangement as a
single new version.

Nothing else about the canvas changes, and run detail's DAG stays strictly read-only — it is a
record of what happened, not something to edit.

Rewiring is the one edit that can introduce a dependency cycle, so cycles are refused with the
path that closes the loop. Cutting an edge whose downstream still reads `{{upstream.x.result}}`
or `$UPSTREAM_X_RESULT` is refused too — both would leave the node reading something that is no
longer connected. Cutting one that an `onlyIf` predicate still names saves with a warning
instead: unlike the other two it does not crash, it silently changes which branch runs, and
nothing else in the codebase checks it.

Two things this turned up along the way. `createNewVersion` does not run schema validation, so
the wiring editor validates before saving rather than assuming the store will catch a bad graph.
And it validates the *difference*: an agent that already fails the schema for an unrelated reason
(a stale enum input, say) can still have its wiring edited, instead of trapping the user behind an
error they did not cause and cannot fix from that screen. Cycle detection runs independently of
the schema for the same reason — the schema's own check lives in a `superRefine`, which is skipped
entirely when the base parse fails, so an already-invalid agent would otherwise get no cycle check
at all.
