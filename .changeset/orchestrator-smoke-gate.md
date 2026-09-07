---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Check generated agents against the live tool catalog again.

Build-from-goal drafts an agent and hands it to you. Since #326 moved `/build` onto the orchestrator, the only thing standing between a drafted agent and your catalog was the structural critic, which works off the plan's own fields. An agent whose shell node calls a tool that does not exist, or whose signal mapping names an output the agent never declares, critiques perfectly clean and then fails the first time it runs. The smoke pass that caught exactly those cases was left behind on the old planner path.

It runs again, per fragment, on the same retry budget as a critic failure — so one bad draft retries itself instead of reaching you or taking the whole build down with it.

The result is also visible now. `recordSmoke` had been writing two columns that nothing mapped onto the telemetry row and no page read, so `/metrics/planner` gained "Agents checked" and "Rejected by the check". The first counts builds whose agents were never checked at all; if it stops falling, the gate has stopped running again.
