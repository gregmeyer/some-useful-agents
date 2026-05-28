---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Inbox triage can now propose running sub-agents on your behalf.

The `inbox-triage` agent learns about an `ALLOWED_SUB_AGENTS` allowlist
and may include an `actions[]` array in its `<plan>` block. The
dashboard renders each proposed action as a card in the conversation
thread with Run / Skip controls — nothing executes until the operator
clicks Run. Running an action invokes the target agent via
`executeAgentDag`, streams the row through `proposed → running →
completed | failed`, and surfaces a result preview + run link. After
the last proposed action resolves and at least one ran, triage gets a
follow-up turn to summarize what came back.

New: `action` response role, `InboxActionMeta` payload (stored in
`inbox_responses.meta_json`), and routes `POST /inbox/:id/actions/:rid/run`
and `/skip`. Modal polling extends to keep refreshing while any action
is in `running` state. Hard cap of 10 actions per message guards
against runaway proposal loops; out-of-allowlist or malformed actions
land as `system` refusal notes.

The v1 allowlist is hardcoded to `suggest-improvements` (intersected
with installed agents at runtime).
