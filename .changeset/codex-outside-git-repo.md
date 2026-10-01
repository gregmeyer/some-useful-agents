---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Codex now works in a project folder that isn't a git repo.

`codex exec` refuses to run outside a trusted git repo ("Not inside a trusted directory and --skip-git-repo-check was not specified"), so every codex attempt failed and fell back for a sua project in a plain folder. sua runs codex read-only, so it now passes `--skip-git-repo-check`.
