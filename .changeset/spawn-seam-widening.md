---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Make the DAG node-spawn seam pluggable for alternate execution backends.

`SpawnNodeFn` now receives the same `onProgress` / `signal` / `onSpawn`
callbacks the in-process spawner gets, and `SpawnResult` carries an optional
`usedWorkflowProvider` a backend self-reports. The executor copies that onto the
node execution row and rolls it up to the run. This is the seam a Temporal-
backed node executor plugs into; behavior is unchanged for the default
in-process path.
