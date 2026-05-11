---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

dashboard: pin "Create new" tiles at the top of the add-tile modal

Replaced the small footer link with two full tile cards pinned at the
top of the modal: **+ Blank agent** (links to /agents/new) and
**✨ Build from goal** (opens the AI wizard). Cards use a dashed
border to distinguish from existing-agent tiles, then turn solid +
primary-accented on hover. Search filter only affects the agent grid
below — the create tiles stay visible regardless of query.
