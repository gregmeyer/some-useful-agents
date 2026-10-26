---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/dashboard": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
---

Remove dashboard code that nothing uses any more.

Pulse and dashboards draw every tile on the canvas, so the old tile route (`GET /pulse/tile/:id`) and its configure, refresh, in-place run and add-tile scripts are gone, which also makes the page script smaller. Also removed: the layout planner's unused suggestion and commit routes, thread fork and retarget, the old way of setting a notebook's look by preset (pick it on the Edit page; Undo still works), and Home's old Notebooks line. Nothing you can see changes.
