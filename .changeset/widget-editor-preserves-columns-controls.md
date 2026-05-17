---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Output Widget editor's Save no longer wipes `columns:` on table fields, `controls:`, or `actions:` — schema shapes the form doesn't yet surface are now carried forward from the previous version.

The dashboard's Output Widget editor only has form fields for `name` / `label` / `type` per field plus the interactive-mode flags. Save used to rebuild `outputWidget` from scratch using only those inputs, silently dropping anything else — so any author who set up `controls:` / `actions:` via the YAML editor, or used the new `type: table` field (which requires `columns:`), would lose them on the next Save click. Preservation rules:

- Per-field `columns:` carry forward when the field name AND type are both unchanged from the previous version. Switching a field's type away from `table` strips its `columns` (the new type can't use them).
- Top-level `controls:` and `actions:` carry forward when the widget type is unchanged. A type switch implies "start over" — controls target arrays the new widget may not surface.

Also adds `table` to the editor's `VALID_FIELD_TYPES` set (was missed in #286), so the type dropdown's `table` option actually saves through instead of being silently coerced to `text`.
