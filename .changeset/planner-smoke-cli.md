---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Add `sua planner smoke` — automated end-to-end smoke tests for the build-planner pipeline.

Hits a running daemon's HTTP endpoints, walks each scenario's poll + (optional) commit flow, asserts against the `planner_telemetry` row + response shapes the wizard expects. Real LLM calls are gated behind `--live` so neither CI nor a stray invocation burns budget.

Six server-side scenarios cover the new critic-loop branches from the previous release: happy-path first-try clean, critic-retry on complex composition, the HN-digest signal.title regression reproducer, critic-exhaustion (3 attempts → "Commit anyway"), dismiss-without-commit, and the empty-commit gating fix. Two browser scenarios (`--browser`) drive the wizard via playwright to verify the warning flash + "Commit anyway" button label and dismiss-mid-retry cleanliness; playwright is loaded dynamically so non-browser users never pay the dep cost.

Run `sua planner smoke` for a dry-run preview, `sua planner smoke --live` to actually execute. Output is one PASS/FAIL line per scenario plus a final summary; exit code 0 iff every selected scenario passed.
