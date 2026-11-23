---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Dashboard tests share one harness, and shipped code no longer checks whether it's running under a test.

The six `process.env.VITEST` checks in the dashboard are replaced by `ctx.live`, which only the real dashboard sets. It starts the queue watchers and lets system agents (Home's Next up, the edition editor, the board reviewer) run a model. A new `test-harness.ts` builds a test dashboard context and tears it down in the right order: it waits for the work the test started, then closes the stores. Work still running at teardown fails the test that started it, by name, instead of breaking a later test with "database is not open".
