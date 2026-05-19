---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Surface Advanced LLM options on `/agents/new` and tighten the radio copy.

PR #300 added per-node LLM options (`provider`, `model`, `maxTurns`, `allowedTools`) to the add-node and edit-node forms but missed the initial-create page. This release fills the gap. The four fields sit under a collapsed `<details>` block ("Advanced LLM options") so the common case — a quick prompt, no extras — stays terse, but power users can set allowedTools / model / maxTurns at create time without round-tripping through an edit page.

Radio copy on `/agents/new` tightened from *"runs an LLM prompt — you have Claude Code and Codex installed"* to *"runs an LLM prompt (Claude Code, Codex installed)"*. The em-dash sandwich was redundant.
