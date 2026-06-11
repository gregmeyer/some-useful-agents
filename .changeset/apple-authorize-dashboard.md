---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Apple integration: dashboard "macOS access" panel — check status + authorize from a Terminal.

The Apple tab now shows a macOS-access card with per-bucket status (Reminders /
Notes), a **Check access** button that probes both TCC buckets with zero-content
reads, and an **Open Terminal & authorize** button that launches a Terminal
running `sua apple authorize` (so the permission prompts appear in a foreground
GUI session). The panel and docs explain the TCC + daemon gotcha: macOS ties the
Reminders grant to the granting process tree, so a detached daemon (and the
temporal worker that runs agent nodes) can show denied even after you authorized
in a Terminal — run agents from a Terminal with `SUA_PROVIDER=local`, or start the
worker in a foreground Terminal.
