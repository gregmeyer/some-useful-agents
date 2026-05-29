---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Inbox modal: preserve selections + triage now dispatches CSP permission edits.

Two fixes bundled:

1. **Selection-preserving polls.** The modal polls every 1.5s and used
   to replace `content.innerHTML` unconditionally, destroying any
   text the operator had highlighted in the conversation (e.g.
   copying triage's reply) and pulling focus out of the composer.
   The poll now skips the DOM swap entirely when the operator is
   actively interacting — focus inside the modal or a text selection
   anchored inside it — and just reschedules the next tick.

2. **Triage dispatches CSP-block permission requests.** Previously the
   triage prompt told operators to open Config → Permissions and
   edit the agent by hand. Now it routes csp-block messages through
   the existing analyzer → editor pipeline: it proposes
   `agent-analyzer` with a surgical FOCUS that names the exact host
   to add to `permissions.imgSrc`, which emits a minimal YAML diff
   and auto-proposes an `agent-editor` action card for one-click
   approval. New OUTPUT FORMAT example covers the
   apod.nasa.gov / demo-astro-tile case verbatim.
