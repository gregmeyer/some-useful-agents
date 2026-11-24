---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Tests no longer call a real model CLI.

The inbox route tests started real triage turns (the installed `claude`), which could outlive the test and write to a closed store ("database is not open"), and the LLM invoker tests ran `claude --print` and `codex exec` whenever those CLIs were installed. Both now use stand-ins; the invoker tests check each case (answered, missing, timed out) deterministically.
