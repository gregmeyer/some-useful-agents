---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Two related Build-from-goal fixes that surfaced from a real-user dashboard
where the planner hallucinated an agent id and the wizard still created
the dashboard pointing at it.

**A. Discovery catalog includes draft agents.** `buildAgentsSection`
previously filtered to `status: 'active'` only, so any agent the user
had scaffolded but not yet activated was invisible to the planner.
Result: when the goal mentioned "the ashby job search," the planner
couldn't see the user's draft `ashby-job-finder` and invented
`ashby-job-hunter` instead. Drafts are now included, marked
`(draft)` in the catalog so the LLM treats them as work-in-progress
candidates rather than hidden. Cap raised from 20 → 30 agents.

**B. Commit refuses to create a dashboard whose tiles reference
agents that didn't land.** Previously each agent in `newAgents` had
its YAML parsed/upserted independently; failures went into
`agentsSkipped[]` but the dashboard was still upserted, leaving the
user with empty "not installed" placeholder cards and no clear cause.
The commit now checks every `dashboard.sections[].agentIds[]` against
both the just-created agents AND the existing AgentStore. If any are
unmet, the dashboard is NOT created and `dashboardError` includes the
ids and the per-agent skip reasons.

3 new tests (catalog draft inclusion, archived exclusion, commit
integrity check); full suite 1075/1075 green.
