---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Refactor: extract the inbox triage/actions engine into its own module.

Second of three behavior-preserving slices of the oversized inbox route file. The
triage + action-execution + learning-extraction engine (runTriageAgent,
runProposedAction, maybeExtractLearning, and the run/refire/auto-propose helpers) moves
into `inbox-engine.ts`, with the runTriageAgent↔runProposedAction cycle kept internal to
that one module. `inbox.ts` is now just the 20 route handlers + router wiring (925 lines,
down from 2249; the engine file is 1355). `TRIAGE_AGENT_ID` moved to the shared leaf so no
sibling module imports the router file (clean acyclic module graph). No logic changes;
full suite unchanged at 2018 pass / 3 skip, and the live routes (list, respond→triage,
fragment, action proposal) were smoke-tested.
