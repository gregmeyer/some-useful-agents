---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Belt-and-suspenders timeout enforcement: kill orphaned LLM processes on reboot + agent-level wall-clock ceiling.

Follow-up to the orphan reaper (last release). The reaper closed the state-machine bleed but didn't stop the orphaned `claude`/`codex` CLI from continuing its current API call. This release adds the two pieces needed to make timeout enforcement actually stop the token burn:

**Agent.timeoutSec — wall-clock ceiling for the whole run.** Per-node `timeout` protects against one node hanging; agent-level `timeoutSec` is the umbrella that catches "10 nodes at 60s each legitimately runs 10 minutes." When the run exceeds the ceiling, the executor aborts the in-flight node (SIGTERM, then SIGKILL after 5s via the cancel-path escalation shipped last release) and marks remaining nodes as cancelled. The run's `error` names the cap directly: `Agent wall-clock timeout (60s) exceeded.`

`layout-planner.yaml` (the agent that revealed the orphan bug) now declares `timeoutSec: 60` — normal runtime is ~20s, the cap catches the dashboard-restart-orphan case without flagging legitimately-slow runs.

**Persist child PID + start time on `node_executions`.** Two new nullable columns: `childPid` (the spawned process's OS pid) and `childStartedAtMs` (wall-clock ms at spawn time). The executor wires `spawnProcess`'s new `onSpawn(pid, startedAtMs)` callback to write both onto the in-flight node row the moment `spawn()` returns.

**Reaper now kills the orphan.** When a `node_executions` row carries `childPid` + `childStartedAtMs`, the orphan reaper SIGKILLs the process before transitioning the row. To defend against PID reuse on long-uptime machines, it first parses `ps -p <pid> -o etime=` and compares the actual elapsed time against the stored start time; if they've drifted apart (PID reuse), the kill is skipped. Production callers get this automatically; tests inject a `killProcess` hook.

`reapOrphanedRuns` now returns `pidsKilled` alongside `runsReaped` / `nodesReaped`. The dashboard boot log surfaces all three.

Tests: +13 (4 for agent timeout, 1 round-trip, 3 for kill behavior, 5 for etime parsing). 1603 pass / 3 skipped.
