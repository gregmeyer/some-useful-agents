---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Fix intermittent "tool did not resolve" for integration agents run from the inbox.

Two related fixes for running integration-backed agents (Apple Reminders/Notes,
and any csv/sqlite/postgres agent) from inbox action cards:

1. **Run-scoped experimental gate.** Apple-tool availability was gated on the
   worker process's `SUA_EXPERIMENTAL_APPLE` env, which varied by launch path —
   so a worker that didn't inherit it would fail with "tool did not resolve."
   The flag is now read once in the (reliable) dashboard process and threaded
   through the run (`SubmitDagRunOptions` → the Temporal activity → the executor
   gate), so resolution is identical wherever the run lands. The env remains a
   fallback for local/CLI runs.

2. **Inbox cards run integration agents on the worker.** Inbox action dispatch
   orchestrated in-dashboard without an integrations store, so integration tools
   never resolved there (and the Apple runner needs the worker's macOS grants).
   Inbox-card runs of DAG agents now go through `submitDagRun` — the whole DAG
   executes on the Temporal worker, exactly like the dashboard's "Run now" — and
   the card status + triage follow-up are driven off the run's terminal state.
   Local-backend runs execute in-process with the integration/tool/agent stores.
