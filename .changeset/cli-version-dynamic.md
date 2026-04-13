---
"@some-useful-agents/cli": patch
---

Fix `sua --version` to report the installed package version instead of the hardcoded string `0.1.0`. The version is now read from the CLI package's own `package.json` at runtime, so it stays in sync with releases automatically.
