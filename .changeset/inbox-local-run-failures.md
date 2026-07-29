---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Local run failures now reach the inbox — with per-agent coalescing so a crash loop is one thread, not fifty.

The run-failure producer was Temporal-only: a scheduled agent failing locally at 3am never raised an inbox item. Local failures now raise too (opt out with `SUA_INBOX_LOCAL_RUN_FAILURES=0`), and the stuck-run watchdog raises items for runs it reaps mid-uptime.

Noise control: a repeat failure of an agent that already has an active run-failure thread is appended to that thread as a system note (with run link, failed node, and error) instead of opening a new one — bounding thread count and giving triage failure-frequency context for free. Per-run dedupe stays as the second layer. Inbox-dispatched sub-agent runs and the triage run itself deliberately never raise items (their failures already land on the action card / crash-retry path), preventing the loop from feeding itself.
