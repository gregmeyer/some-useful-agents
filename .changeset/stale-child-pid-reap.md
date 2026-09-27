---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Stop the watchdog reaping runs that are still working.

A node records the process id of the child it spawns, so a restarted dashboard can kill an orphan instead of letting it burn tokens. Nothing ever cleared that id, and a node can outlive its child — most sharply in the LLM provider waterfall, where a CLI provider spawns a child while an OpenAI-compatible provider is a plain HTTP call that spawns nothing. When the chain fell from one to the other, the row went on naming a process that had already exited.

The stuck-run watchdog probes exactly that field to decide whether a run is making progress. A dead id it could not distinguish from a dead run, so it reaped nodes that were mid-request. The run would then finish moments later and write its own success over the top, leaving a completed run permanently labelled with a watchdog error — and an inbox alert saying the agent had failed when it had not.

The id is now cleared the moment the child exits, so a run that has moved on to an HTTP provider is judged by the age ceiling like any other work with no child to probe.
