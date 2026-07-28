---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Autonomous inbox triage is now the default, and Stop actually stops things.

`SUA_INBOX_AUTO_TRIAGE` flips from opt-in to opt-out: new inbox items get analyzed — and trusted actions run — without a human poke, out of the box. Opt out with `SUA_INBOX_AUTO_TRIAGE=0` or `experimental.inboxAutoTriage: false`. The staged rollout is complete: durable restart recovery and the coalesced local-failure producer landed first, and all per-thread guards (5-turn cap, action cap, one-write-per-turn) are unchanged.

The operator Stop button now cancels in-flight sub-agent action runs — local dispatches register an AbortController so the executor is actually interrupted; Temporal runs get a best-effort provider cancel plus a local force-finalize (the worker may still finish server-side). Previously Stop only suppressed the *next* turn while the current action ran to completion.
