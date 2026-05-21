---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Wire the build-orchestrator drafters into the critic-retry loop so the structural critic gets a second pass instead of leaking broken drafts to the user.

- **New critic check**: `critiquePlan` now flags `ai-template` widgets that use nested placeholder paths (`{{outputs.X.Y}}` or `{{item.X.Y}}` inside `#each`). The placeholder substituter only supports single-level paths; nested paths leak the literal `{{…}}` into the rendered tile. Each offending placeholder produces a concrete error with guidance to flatten the value into a scalar top-level output.
- **Per-drafter retry**: after a drafter completes successfully (autoFix + parseAgent), the orchestrator wraps the draft in a synthetic single-agent BuildPlan and runs `critiquePlan` on it. If errors are found and the drafter still has retry budget (up to 3 attempts), the orchestrator kicks off a fresh drafter run with the critic feedback appended to FOCUS. After exhausting retries, the critic errors surface as the failure reason instead of accepting a broken draft.
- Same logic applies to single-spec drafters (the Improve-layout `/agents/draft-one` path).
