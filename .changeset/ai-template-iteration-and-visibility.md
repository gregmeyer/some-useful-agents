---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

ai-template iteration + per-agent visibility toggles.

The ai-template widget now supports `{{#each outputs.X as item}}…{{/each}}` block iteration (with nested `{{item.field}}`, escaped `{{item.field}}` vs unescaped `{{{item.field}}}`, and `{{@index}}`) plus a `{{{outputs.X}}}` triple-brace unescaped variant. List-shaped agent outputs (HN feeds, GitHub PR digests, monitoring dashboards) can now render proper card layouts instead of HTML-escaped JSON blobs.

Adds two new top-level agent fields — `pulseVisible` and `dashboardVisible` (both default true). Toggleable from a new Visibility card on the agent Config tab. `pulseVisible: false` hides a tile from /pulse even when a signal is declared (legacy `signal.hidden` still honored). `dashboardVisible: false` hides the agent from the /agents list view; it remains reachable via direct URL, MCP, scheduler, and the runs page.
