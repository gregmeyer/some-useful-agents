---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Copy a notebook to sua on another machine: Download / share → Notebook file, and Import a notebook file.

A notebook's Download / share menu has **To another sua → Notebook file** (`/notebooks/:id/export.suanb`); New notebook links to **Import a notebook file** (`/notebooks/import`), which shows what importing will do (agents and tools added or kept, a new id if its id is taken, secrets this machine lacks, the schedule turned off) before **Import**. The CLI has `sua notebook export <id> [file]` and `sua notebook import <file> [--yes]`.
