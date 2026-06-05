---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Fix Temporal node runs dying on a false heartbeat timeout.

`runNodeActivity` only heartbeated when a node emitted a progress event, with a
30s heartbeat timeout and no keepalive. An LLM node that thinks for longer than
30s before its first streamed token (e.g. agent-builder's `design` step,
inbox-triage's `triage` step) went silent, so Temporal killed the activity with
"activity Heartbeat timeout" even though the child process was working fine — the
run was recorded as a generic "Temporal node workflow failed: Workflow execution
failed". A keepalive heartbeat now fires every 10s while the node runs, matching
the whole-DAG activity.

Also unwrap the underlying cause when a node workflow fails: the dashboard now
surfaces the real reason (the activity error or heartbeat timeout) instead of
Temporal's boilerplate "Workflow execution failed".
