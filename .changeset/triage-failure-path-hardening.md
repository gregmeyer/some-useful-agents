---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Inbox triage failure-path hardening.

Two fixes so a failure no longer leaves the operator stuck or chasing dead links:

- **Transient triage crashes auto-retry instead of stranding the thread.** A
  crashed triage run (provider hiccup, worker dispatch race, network) now
  retries once with a short backoff before posting a terminal note, and the
  thread is always left `awaiting_user` so it stays actionable. A fresh reply
  or "ask triage" refreshes the retry budget.
- **Run-failure inbox alerts only mention Temporal when there's a real workflow.**
  The note always links the `/runs/<id>` page; it now offers a Temporal UI deep
  link (and the "ran on Temporal" wording) only when the run reached a durable
  workflow (`temporalRunId` set). Setup failures that never dispatched a
  workflow no longer send the operator hunting for a `sua-node-…` execution
  that was never created.
