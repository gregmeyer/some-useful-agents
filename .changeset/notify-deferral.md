---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Notify deferral: one page per retry chain, not one per attempt (R3).

When an agent has a `retry:` policy, `notify:` handlers now fire **once per chain** at the terminal outcome instead of once per attempt. A 3-attempt agent that recovers on attempt 2 produces one `success` notify and zero `failure` notifies. A run that exhausts its budget over three failed attempts produces one `failure` notify, not three.

Mechanism: `executeAgentDag` accepts a new `suppressNotify` option that the orchestrator sets on every internal attempt. The wrapper fires notify itself after the chain settles. Agents without a `retry:` policy fall through to single-attempt mode and fire notify exactly as before — no behavior change.

Builds on R1 (manual retry) + R2 (auto-retry policy). R4 (triage surface) and R5 (scheduler backoff) still to come.
