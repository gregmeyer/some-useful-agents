---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Triage learnings: consult approved lessons in the triage prompt (final slice).

Flips cross-thread triage learnings from "stored" to "consulted". When a thread
is triaged, approved lessons relevant to it (matched by agentId + source) are
retrieved and injected as a numbered `RELEVANT_LEARNINGS` block in the triage
prompt, with a new kernel section that frames them as advisory priors — they
inform the recommendation but never authorize an action, and the live
conversation is ground truth on conflict. Top-K capped with a byte budget.

Still gated by `SUA_EXPERIMENTAL_TRIAGE_LEARNINGS`; with the flag off the input
is empty and the kernel section no-ops. Completes the learnings loop
(extract on resolve → approve → consult).
