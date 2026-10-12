---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

A codex step that finished its answer is no longer failed by a late exit code.

- **The bug:** codex sometimes exits with code 1 after completing its turn and giving its answer, with no error of its own. The step failed, its answer was thrown away, and the steps after it were skipped.
- **The fix:** the step now keeps its answer and completes, with a warning saying what happened.
- **When codex fails without a reason:** the error now says so, instead of showing its "Reading prompt from stdin..." banner.
