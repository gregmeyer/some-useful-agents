---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Fix: run-detail live updates no longer wipe the DAG graph or the CSP "Allow" banner.

The run page auto-polls every 2s and swaps in a fresh `[data-run-container]`
fragment via `innerHTML` + `replaceWith`. Two pieces of client UI didn't survive
the swap:

- **DAG graph went blank.** Scripts inserted via `innerHTML` never execute
  (HTML5), so the cytoscape bootstrap stopped running after the first poll and the
  new `#dag-canvas` rendered blank for the rest of the run. The bootstrap is now a
  re-callable, per-canvas-idempotent global (`window.renderDagViz`) that the poll
  re-invokes after each swap, so the graph stays visible and node colors update
  live as the run progresses.
- **CSP "Allow host" banner disappeared mid-run.** The banner for CSP-blocked
  widget images was mounted *inside* `[data-run-container]`, so the poll destroyed
  it; the violation listener's host-dedupe then suppressed re-rendering, so the
  "Allow" button vanished on the first poll and never came back. It's now mounted
  as a sibling in the container's stable parent, surviving every swap.

The root cause behind both was that the poll replaced the entire
`[data-run-container]` every 2s. The poll now **reconciles only the regions that
changed** (`data-poll-region` markers: status, meta, error, result, nodes) instead
of nuking the container — so the DAG canvas (kept via a `data-poll-preserve`
region), focused inputs, the node search/filter, and scroll position all survive a
live update. The DAG bootstrap re-renders only when its data actually changed
(signature check), reusing the same `#dag-canvas` element. Finally, the
currently-running DAG node now **pulses** (glowing halo + breathing border) so
it's obvious at a glance which step is live.

Also fixed: the DAG sometimes rendered only the middle node. Cytoscape doesn't
auto-resize, so if the initial `fit()` ran before the canvas reached its final
size (sticky grid settling, fonts loading), the viewport stayed zoomed to a
stale box and the outer nodes were clipped. The bootstrap now attaches a
`ResizeObserver` that re-fits on any canvas resize. And `graph-render.js` is now
served `no-cache` (it was `max-age=300`), so DAG fixes land on refresh instead of
being masked by a 5-minute stale cache.
