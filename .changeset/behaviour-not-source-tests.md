---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Tests check what the code does, not how its source reads.

The guards that read `node-spawner.ts`, the Temporal activity files and `notebook-steps.ts` as text are replaced by tests that run the code. A behavior file's `{{inputs.X}}` is checked to stay literal in the prompt a model endpoint actually receives. The behavior block is checked to cross the Temporal activity boundary and to lead the prompt on the worker. A written Runbook page is checked not to be sent to the page agent again. A harmless refactor no longer turns main red, and a real regression still does.
