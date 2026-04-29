---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Add `.claude/` to `.gitignore` so subagent worktree directories from Claude Code sessions can't accidentally land in commits as embedded git repositories.

No runtime impact; repo-hygiene only.
