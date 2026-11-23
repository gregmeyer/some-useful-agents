---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

The notebooks route tests are split by theme and run on the shared test harness.

The 7,000-line `notebooks.test.ts` is now six files (pages, funnel, new notebooks, steps, writing, more) sharing one setup, `notebooks.test-kit.ts`, built on the shared test harness. They run in parallel, and work a test leaves running fails that test by name. Nothing changes for users.
