---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Notebook pages and boards update in place instead of redrawing.

When a notebook page or board finds something new (a step finished, a part appeared, a finding changed), only the components and data that changed are sent to what's already drawn, using A2UI 1.0's component and data updates. Nothing else redraws, so the page doesn't flicker or jump and an open panel stays open. Before, any change to a page's parts redrew the whole column.
