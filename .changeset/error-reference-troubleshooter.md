---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Error-reference catalog + auto-attached troubleshooting + `error-troubleshooter` agent.

Every run failure now comes with actionable help. A new error-reference catalog
in core (`ERROR_CATALOG`) maps every failure category and common shell exit code
to what it means, its likely causes, and concrete troubleshooting steps — the
single source of truth for two surfaces:

- **Auto-attach**: when a run fails, its inbox thread now includes a
  "What this means / Likely causes / Try:" section, looked up by the failed
  node's category + exit code (the exit code wins when catalogued). Deterministic,
  no LLM, no setup.
- **`error-troubleshooter` agent**: a new bundled example agent (inbox-runnable)
  that answers "what does exit 127 mean?" on demand, reading the catalog via a
  read-only SQLite tool. Its `error-reference` SQLite integration is
  auto-provisioned on dashboard boot and `sua examples install` / `sua init`
  (generated from the catalog), so the agent works out of the box.
