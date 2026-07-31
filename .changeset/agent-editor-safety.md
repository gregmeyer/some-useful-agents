---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Autonomous agent-editor can no longer corrupt a working agent.

Two gaps let a triage "apply YAML fix" persist a broken agent (observed live: a working `make-a-reminder` was overwritten with a run-time-broken one):

- **Schema was too loose** — an `agent-invoke` node with no `agentInvokeConfig` passed `parseAgent` and only failed at run time ("agent-invoke node missing agentInvokeConfig"). It's now rejected at parse, so `executeAgentEditor` refuses the edit and posts the reason to the thread instead of overwriting the good agent.
- **Template escapes leaked** — `executeAgentEditor` committed `NEW_YAML` raw, so the templating pipeline's `{{` → `{ {` safe-escape was persisted as a literal `{ {inputs.X}}` that never resolves. The editor now un-escapes before committing (previously only shell `command`s were repaired, so `toolInputs`/prompts corrupted silently).

Net: a structurally-invalid autonomous edit bounces off validation, template edits stay intact, and agents remain versioned on upsert so any edit is rollback-able.
