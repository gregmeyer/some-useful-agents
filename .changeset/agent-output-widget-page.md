---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Dashboard: move Output Widget editor to its own page with sub-tabs, and make Preview match Pulse.

The Output Widget editor was a ~1200px inline section on the Config tab — widget-type cards, contextual helper, field table, AI-template branch, interactive-mode subform, action bar, and live preview all stacked in one form. It now lives at `/agents/<id>/output-widget` with sub-tabs **Type**, **Fields**, **Interactive**, and **Preview** filtering which sections are visible. The action bar (Save / Remove) stays visible across all tabs. Save and validation errors return you to the editor (preserving iteration) instead of bouncing to Config. The Config tab's Output Widget card collapses to a one-line summary (`Type: dashboard, Layout: 5 fields, Interactive: yes`) plus an "Edit" link.

Preview now respects `interactive: true`. When the editor's Interactive checkbox is on, the Preview tab renders the same `renderInteractiveWidget` Pulse uses (with the configured runInputs filter, askLabel, and replayLabel applied) — in `staticPreview` mode so clicks don't accidentally submit a real run. Previously the preview always rendered the static widget output, hiding the visual effect of every Interactive setting.
