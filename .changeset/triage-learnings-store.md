---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Triage learnings: store + retrieval + flag (dormant plumbing).

First slice of cross-thread triage learnings (experimental, off by default). Adds a
`triage_learnings` table to InboxStore with `addLearning`/`getLearning`/`listLearnings`/
`updateLearningStatus`/`deleteLearning` and a structured-retrieval query
`listApprovedLearningsForTriage` (keys on agentId + source + scope, newest-approved first,
capped). Lessons are deduped on a normalized form. Adds a generic `extractTaggedJson(raw, tag)`
core helper (generalizes `extractPlanJson`) and the `isTriageLearningsEnabled()`
(`SUA_EXPERIMENTAL_TRIAGE_LEARNINGS`) flag with the CLI config bridge. Nothing is wired into
the inbox UI or triage prompt yet — that lands in follow-ups.
