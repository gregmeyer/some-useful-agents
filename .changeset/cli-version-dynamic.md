---
"@some-useful-agents/cli": patch
---

Two CLI fixes:

1. **`sua --version` now reports the real version.** Previously hardcoded as `0.1.0`; now read from the CLI package's own `package.json` at runtime so it stays in sync with releases automatically.

2. **Tutorial `explain` prompts no longer hallucinate commands.** The prompt sent to Claude/Codex now includes the exact CLI command surface, so deep-dive answers use real commands like `sua agent list` instead of invented ones like `sua list`.
