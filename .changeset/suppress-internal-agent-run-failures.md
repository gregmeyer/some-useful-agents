---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Stop internal `_`-prefixed helper agents from raising run-failure inbox threads.

The dashboard spins up ephemeral synthetic agents to do its own work — `_yaml-fixer` (auto-repair a broken agent's YAML) and the build planner/surveyor/drafter. When one failed (e.g. its `claude-code` node hit `binary_missing` at setup), it raised a "Run failed: _yaml-fixer" inbox thread, which triage then reasoned about as a broken user agent ("import/install _yaml-fixer and inspect the run") — advice impossible to follow, since these aren't installable agents. `raiseRunFailureInbox` now skips any run whose agent id starts with `_`, so internal-helper failures surface inline in the build/fix UI instead of as un-actionable inbox noise.
