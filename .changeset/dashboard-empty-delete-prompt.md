---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Removing the last tile from a user-owned dashboard now offers to delete the empty dashboard. The tile-delete route flags the redirect with `emptyDashboard=1` when no tiles remain; the dashboard view then shows an in-app modal ("Delete empty dashboard, or keep it to add tiles later?") with Delete dashboard / Cancel. Pack-owned dashboards are excluded (they can't be deleted directly). The confirm modal was refactored to support programmatic invocation (`showConfirm({ message, title, label, onConfirm })`) in addition to the existing `data-confirm-modal` form interception.
