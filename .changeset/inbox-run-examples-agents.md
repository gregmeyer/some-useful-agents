---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Inbox triage can run (and broker "Enable & run" for) first-party example agents.

The inbox runnable allowlist and enable-and-run candidate list gated on
`source ∈ {local, community}`, which silently excluded every `examples`-source
agent — so a bundled agent that opted into `inboxRunnable` (e.g. adr-logger) was
neither runnable nor an approve/deny candidate, and triage dead-ended with
"enable inbox-run yourself" (advice that wouldn't even help). Examples agents
are now included; the triage scaffolding stays excluded via SYSTEM_AGENT_IDS,
not source.
