---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Notebooks can be archived or deleted.

Both are in a notebook's Edit panel.
- **Archive** hides it from the notebooks list, Home, Today and sua's notebook list, and stops its schedule. Nothing is deleted. It's under a new **Archived** tab, and its page offers **Restore**.
- **Delete…** asks once, then removes the notebook and everything in it: options, history, searches, photos and layout. Its pages return "not found", while its conversation and the runs that fed it stay. Delete is refused while its pipeline is running.

`NotebookStore` gains `archive`, `unarchive` and `delete`. `list()` leaves archived notebooks out unless asked (`archived: 'include' | 'only'`). `SurfaceStore` gains `remove`.
