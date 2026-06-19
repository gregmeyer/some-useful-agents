---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Triage learnings: extractor + resolve trigger + approval UX (flag-gated).

Second slice of cross-thread triage learnings (experimental). Adds the
`inbox-learning-extractor` system agent and wires the loop end-to-end:

- A new **Mark resolved** affordance + `POST /inbox/:id/resolve` route (finally
  wiring up the long-dormant `resolved` status). On resolve, `maybeExtractLearning`
  runs the extractor (gated cheapest-first: flag off → no-op; only run-failure /
  permission-request threads with real triage activity reach the one LLM call) to
  distill at most one durable lesson, stored as a `pending` learning.
- The thread modal renders a **"Triage learned something"** card with Approve /
  Discard; `POST /inbox/:id/learnings/:lid/(approve|reject)` routes decide it.
  Approved lessons become retrievable; rejected ones are dead.

Still dormant unless `SUA_EXPERIMENTAL_TRIAGE_LEARNINGS` is set, and learnings are
not yet injected into the triage prompt (that lands in the final slice).
