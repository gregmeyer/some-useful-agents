---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Widget controls (`sort` / `filter` / `paginate` / `view-switch` / `field-toggle` / `replay`) now render everywhere a widget appears — Pulse, home dashboard, interactive tiles, run detail, agent detail — and look-and-feel is owned by the widget author's `<style>` block instead of hardcoded inline styles.

**Previously**: Pulse / home / interactive callers passed `controlState=undefined`, which short-circuited both the data-transform step (schema defaults like `sort.default: date desc` and `pageSize: 5` never applied) and the controls-row rendering. Tables looked unsorted/unpaged on every surface except the agent detail page.

**Now**: those callers pass an empty `controlState ({})`. Schema defaults take effect on every surface; the interactive controls (chips, filter input, page nav) appear on every surface and respond to URL state the same way everywhere.

**Styling contract**: control renderers emit semantic CSS classes (`.wc-row`, `.wc-group`, `.wc-chip`, `.wc-chip--active`, `.wc-clear`, `.wc-input`, `.wc-button`, `.wc-page-info`, etc.) with no inline `style="…"` attributes. The dashboard ships sensible defaults in `components.css`. Agent `<style>` blocks can override appearance — e.g. `<style>.wc-chip { background: var(--my-brand); }</style>` inside an `ai-template` template restyles the chips on that widget specifically.

Two PRs ago (#278) we made the sanitizer preserve `<style>` blocks specifically so this pattern would work; this PR completes the loop.
