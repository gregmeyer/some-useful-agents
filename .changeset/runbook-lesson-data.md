---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

A runbook's writer gives goals, phases, what you'll need, a recap and a self-check.

A runbook answer can now carry a `lesson`: what you'll be able to do, what you'll need (one item each), how you know you're done, three key points, what to try next, and a short self-check with answers. Each step can carry a `phase` ("Prep", "Make", "Finish"). The writer is asked for them; core keeps them (`cleanRunbookLesson`) and adds `runbookNeeds` (what to have ready, split from an older runbook's ready part) and `runbookPhases`. The page data carries them at `/notebook/runbook/lesson`, ready for the lesson-style Runbook page.
