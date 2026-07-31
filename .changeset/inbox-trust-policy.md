---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Operator-tunable trust: decide what the inbox may run on its own.

Autonomous triage was governed by a hardcoded set of auto-approved agents. B2 makes it operator-controllable, two levels deep:

- **Global autonomy mode** (a control in the inbox header): **Full** (trusted agents auto-run), **Approve first** (triage still analyzes, but every action waits for your click), or **Off** (the whole loop pauses — a real kill switch that also stops auto-first-touch). 
- **Per-agent trust** (a toggle on each action card): flip a specific agent between auto-run and require-approval — the fine-grained answer to "agent-builder is committing things I'd rather approve" — with a reset to the built-in default.

Backed by an additive `inbox_trust` table; an untouched install behaves exactly as before (the engine falls back to its compiled default set), so the policy layer is inert until you edit it. Resolution order: global mode → explicit per-agent override → default set.
