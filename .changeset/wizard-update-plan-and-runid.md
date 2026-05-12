---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

dashboard: Build-from-goal Plan-ready stage gets an "Update plan" form

The Questions block now renders a textarea + **Update plan** button. Typing
clarifications and clicking Update plan re-runs the planner with the
original goal plus the appended answer, instead of asking the user to
copy-paste their reply into the (now-hidden) goal field and start over.

Also fixes a long-standing bug where clicking **Commit** threw
`ReferenceError: runId is not defined` because `wireCommit` referenced a
variable that lived inside an inner `.then` scope. The planner runId is
now lifted to the outer planner-run scope so commit-time telemetry
correlation works.
