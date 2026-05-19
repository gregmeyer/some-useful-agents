---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Layout curation now correctly handles draft/archived agents and stops loading hidden signals on Pulse.

Three connected fixes after live-testing the curation flow:

- **Curation reaches draft/archived agents.** The commit endpoint previously skipped agents whose status was `draft` or `archived`, so any draft agent with `pulseVisible !== false` slipped through curation and re-appeared on Pulse via the auto-"Other" container in `widget-layout.js.ts`. The Pulse view itself doesn't filter by status — only by signal + pulseVisible — so curation now matches that exactly.
- **Planner sees the same set Pulse renders.** `gatherAgentMetadata` lost its archived/draft filter for the same reason; it now agrees with the Pulse route's actual visibility rule. The planner no longer wastes `topAgents` slots on agents that can never render (those without a `signal:` block — `build-planner`, `agent-analyzer`, `agent-builder`, etc. — already got excluded via the `!signal` skip; this PR just keeps that invariant clean).
- **Hidden-signals section is compact.** Previously every hidden agent rendered as a full tile inside a `<details>` block. Now the section is a one-line summary (`N signals hidden from Pulse`) with **Show all** + **Manage in /agents** buttons. The route also skips the expensive `buildTile()` call for hidden agents — they only contribute to a count.
