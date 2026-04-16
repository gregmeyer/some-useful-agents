---
"@some-useful-agents/core": minor
"@some-useful-agents/dashboard": minor
---

**feat: tool picker on node forms + tool config/actions types (PR 4 of 6 for v0.16).**

Replaces the Shell/Claude Code type radio on add-node and edit-node forms with a tool dropdown listing all 9 built-in tools + user tools. Selecting a tool dynamically renders its declared input fields with palette autocomplete (both `$` and `{{` triggers). Extends the tool model with `config` (project-level defaults) and `actions` (multi-action tools).
