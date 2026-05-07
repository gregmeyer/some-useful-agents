---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Fix `spawn E2BIG` on claude-code nodes with large upstream outputs.

`claude-code` nodes were spawned with the resolved prompt as a single argv element AND with every upstream node's full result copied into env vars (`UPSTREAM_<ID>_RESULT`). When `{{upstream.X.result}}` substitution produced a fat prompt — typical for any agent whose upstream shell node returns a JSON payload or HTML page — `argv + env` total exceeded the kernel's `ARG_MAX` (~256KB Linux, lower under sandboxes), and `execve()` failed with `spawn E2BIG`. Surfaced loudly on `ashby-job-finder` running under a parent loop: any iteration whose company had a meaty job board (e.g. `ashby`, `zip`) failed instantly.

Two changes:

1. **Prompt rides on stdin instead of argv.** `claudeSpawner` / `claudeTextSpawner` no longer include the prompt as a positional arg; `spawnProcess` opens stdin as a pipe (new `stdinInput?: string` option) and writes the prompt. Claude CLI in `--print` mode reads from stdin natively.
2. **`UPSTREAM_*_RESULT` env vars are stripped before exec for claude-code nodes.** They were already consumed at template-substitution time; passing them to claude was redundant bytes that contributed to the same ARG_MAX cap. Shell nodes still receive these env vars (intended consumer: `$UPSTREAM_<ID>_RESULT` references).

Codex spawner is left untouched in this PR (its CLI's stdin support hasn't been verified) — same fix applies and is tracked as a fast-follow.
