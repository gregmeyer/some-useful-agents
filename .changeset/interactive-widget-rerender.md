---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Fix interactive widgets rendering raw JSON in a `<pre>` on completion.

PR #166's interactive widgets shipped with a known follow-up: when a run completed in the tile, the result body got pretty-printed JSON instead of the actual widget. The proper widget render only appeared on the next pulse refresh, which broke the in-place feel — the whole point of interactive mode.

Fix: `GET /runs/:id/widget-status` now server-renders the agent's `outputWidget` against the run result and includes a `widgetHtml` string in the response when the run is `completed` and the agent has a widget. The tile JS swaps that HTML into the result box on success, with the same fade-in transition as before. Falls back to the prior `<pre>` behavior when no widget is configured (e.g. agent without an outputWidget) or the widget renderer rejects the result.

Same renderer that powers the static pulse tile now runs on the widget-status endpoint, so the rendering is identical between first-load and post-run states. No client-side widget logic to keep in sync.
