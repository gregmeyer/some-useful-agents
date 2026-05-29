---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

inbox-triage: auto-refresh the triage agent itself from bundled YAML.

PR #398 added auto-refresh for the SUB-agent allowlist (analyzer,
editor, catalog-search) but `inbox-triage` itself was left out. So
operators who installed inbox-triage before PR #395 — which added
the VOICE section telling the model to write the recommendation AS
the assistant reply, not as stage directions — kept seeing
"Reply directly with X: ..." prefixes on every triage turn, even
after running the latest dashboard build.

Extracts the diff-and-refresh logic into `ensureSystemAgentCurrent`
and calls it for the triage agent at the start of `runTriageAgent`.
Same diff trigger: refresh fires when the installed exported YAML
differs from `agents/examples/inbox-triage.yaml` on disk.
