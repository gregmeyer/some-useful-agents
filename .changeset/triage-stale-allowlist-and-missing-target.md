---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Inbox triage: auto-refresh stale allowlist agents + clear error when dispatch target is missing.

Two compounding bugs that broke the analyzer dispatch path shipped
in #397:

1. **Stale system allowlist agents.** The auto-import in
   `getSubAgentAllowlist` only fired when an allowlist agent
   (analyzer / editor / catalog-search) wasn't installed at all —
   never when the bundled YAML on disk had changed since install.
   Operators who installed `agent-analyzer` before PR #394 still had
   the pre-preflight version (`AGENT_YAML: required: true`, no
   preflight node) and any dispatch died at input resolution with a
   generic "Missing required input AGENT_YAML" — looking like an
   analyzer bug rather than a stale-install issue. Now compares the
   installed exported YAML against the bundled file and re-imports
   when they differ. Scoped to allowlist entries only; user agents
   are never touched.

2. **Silent enrichment when target agent is missing.** When the
   inbox message referenced an agent that wasn't installed (e.g. a
   permission-request for `demo-astro-tile` on a fresh catalog),
   `enrichAgentAnalyzerInputs` silently left `AGENT_YAML` empty and
   the analyzer dispatch went through anyway — surfacing the same
   confusing "missing required input" rather than the real cause.
   Now the route refuses the dispatch upfront, sets the action card
   to failed with a clear refusalReason, and posts a system response
   to the conversation: "Can't dispatch agent-analyzer — the target
   agent <id> is not installed in this catalog."
