---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Fix a test that started failing once its fixed date was more than 30 days old.

The Temporal provider's resume test seeded a waiting run with a fixed start date. Opening the run store sweeps runs older than its 30-day retention, so after Oct 29 the run was gone and the test failed. It now seeds a run from an hour ago. No change to the published code.
