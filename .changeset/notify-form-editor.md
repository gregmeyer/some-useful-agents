---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Form-based notify editor for the dashboard.

Replaces the JSON textarea on agent config with a structured form. Top-level checkboxes for `on` (failure/success/always), a comma-separated list for declared `secrets`, and per-handler cards with type-specific fields:

- **slack** — `webhook_secret` dropdown (populated from the secrets list), `channel`, `mention`
- **file** — `path`, `append` checkbox
- **webhook** — `url`, `method` (POST/PUT), `headers_secret` dropdown (optional, also populated from the secrets list)

Three "+ Add slack / + Add file / + Add webhook" buttons let operators compose the handler array without remembering schema field names. Removing a handler is an in-row "Remove" button. Saving serializes the form state to a single hidden `notify_json` field; the route validates the payload through the same `agentV2Schema` as the YAML import path so cross-checks (e.g. handler-referenced secrets must be declared) still fire.

Backwards compat: the route accepts either the new `notify_json` field (preferred) or the legacy `notify` JSON blob — ad-hoc API callers and existing tests aren't broken.

Out of scope (future): live Block Kit preview for slack handlers; channel picker via Slack OAuth (depends on PR-C); secret-name autocomplete (the cross-check at save time covers typos).
