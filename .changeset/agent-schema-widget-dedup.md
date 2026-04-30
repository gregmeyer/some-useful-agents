---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Fix YAML round-trip silently stripping `outputWidget` fields.

`agent-v2-schema.ts` carried its own inline `outputWidget` zod definition that had drifted from the canonical `outputWidgetSchema` in `output-widget-schema.ts`. Anything that round-tripped agents through YAML (`workflow import-yaml`, `agent install`, `workflow export` → re-import) lost the missing fields silently because zod accepted the document but the inline definition didn't list those keys.

Drift accumulated over time:
- `ai-template` widget type
- `preview` field type
- `prompt` and `template` fields (ai-template generator output)
- `interactive`, `runInputs`, `askLabel`, `replayLabel` (PR #166)

Fix: the inline schema is replaced with `outputWidgetSchema.optional()` so there's a single source of truth.

Surfaced when adding `interactive: true` to the Magic 8-Ball agent via `workflow export → patch → workflow import-yaml` and observing the field disappear on re-export. Also fixes the latent bug where ai-template widgets authored via the dashboard couldn't survive YAML round-trip — they parsed cleanly but the prompt/template fields were stripped.

No agent data migration needed; existing DB-stored widgets keep their fields and now correctly survive a YAML round-trip.
