---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

notify: handlers can reference a saved integration by id

PR 2 of 4 of the Settings → Integrations workstream. Notify handlers
gain an optional `integration: <id>` field. When set, the dispatcher
resolves the named integration from #262's store at fire time, merges
its config (webhook URL secret, channel, path, etc.) into the handler,
and unions the integration's `secretRefs` into the resolution bag so
agents no longer need to repeat them in `notify.secrets`.

Inline fields on the handler still override the integration's config
— useful when one agent wants a different channel than the saved
default. Missing or wrong-kind integration logs and skips the
handler, never failing the run (matches the existing reliability
contract).

YAML schema gates: each handler must EITHER reference an integration
OR carry its kind-specific required inline fields (webhook_secret /
url / path). Existing YAML keeps working unchanged.

Dashboard: the per-agent Notify card now shows a per-handler
"Integration" dropdown listing matching kinds (with a link to manage),
plus a fall-through "Inline config (legacy)" option.

Tests: +5 dispatcher tests covering successful resolution, inline
overrides, missing-integration skip, kind-mismatch skip, and the
integration-driven secret union.
