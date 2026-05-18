---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Output Widget editor: edit all 6 `controls` types inline (sort / filter / paginate / replay / field-toggle / view-switch).

Phase 2 of the editor-UI-for-table-things work after #288 (columns editor). A new collapsible Controls section between Fields and Interactive renders one bordered row per control with the type-select up top and per-type inputs below. The active type's inputs show; the rest are hidden but still SSR'd so toggling the type select via JS just swaps visibility (no rebuilds).

- **sort** / **filter** / **paginate**: array name + columns (csv) + per-type knobs (default `col asc`, placeholder, pageSize). Pair with `type: table` fields by sharing the array name.
- **replay**: optional label + optional inputs subset (csv). Re-runs the agent inline. The auto-synthesised replay from interactive mode still applies when none is declared.
- **field-toggle**: label + toggleable fields (csv) + default (shown / hidden).
- **view-switch**: label + views JSON (rarest type — nested `[{id, fields[]}]` edited as JSON in a textarea for now) + default view id.

The editor now posts a hidden `widget_controls_edited=1` sentinel so the server can distinguish "user deleted all controls" (honour deletion) from "non-editor caller silent on controls" (keep #287's prev-version preservation). Empty / half-built control rows skip silently instead of failing schema validation. Malformed view-switch JSON drops just that row.

Tests cover all 6 types parsing, the empty-edit sentinel path, the non-editor preservation path, and the malformed-JSON skip.
