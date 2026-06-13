---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Clearer error when a tool node fails to resolve + multi-worker warning.

When a node references a `tool:` that doesn't resolve (integration disabled via the
experimental flag, not installed, or the worker running stale code), the executor
reported the misleading "Shell node X has no command" / "not found in registry or
store". It now says: tool "<id>" did not resolve — integration may be disabled, not
installed, or this worker may be stale (restart it). `sua daemon status` also warns
when more than one worker is polling the Temporal queue, since competing workers are
a common cause of these flaky failures (a run lands on an ungranted/stale worker).
