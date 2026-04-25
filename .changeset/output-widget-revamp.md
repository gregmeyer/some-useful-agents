---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Output Widget editor made self-teaching.

Replaced the bare widget-type dropdown with a card picker. Each card has a description, ASCII layout sketch, and context-aware helper copy that updates as you switch. Field-type dropdown gains per-type tooltips and dims types that don't apply to the selected widget.

New **"Load example"** dropdown with 5 starter widgets (Report card, Metric dashboard, File preview, Diff applier, Key-value summary) that populate the form in one click.

New **live preview card** below the form that rerenders the widget with synthetic sample data on every edit. Backed by a new `POST /agents/:id/output-widget/preview` route — no DB writes — that reuses the existing `renderOutputWidget()` renderer.

Matching polish on the Pulse "Output Widget" tile explainer so both surfaces use the same vocabulary.
