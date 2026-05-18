---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Single source of truth for LLM provider metadata.

Adds `PROVIDERS` registry + `ProviderDef` type in `@some-useful-agents/core`, with one entry per supported CLI (display name, binary, version argv, prompt argv). `detectLlms()` and `invokeLlm()` now iterate the registry instead of hard-coding two branches. The dashboard's "New Agent" form reads provider display names from the same registry, and its TYPE radio is relabeled "LLM Prompt — runs an LLM prompt — you have {list} installed" so users see which CLIs are actually on PATH. Public API of `detectLlms` / `invokeLlm` is unchanged; this PR is preparation for adding more providers without a parallel call path.
