---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Add `sua worker install-launchagent` for a durable, GUI-session worker (macOS).

A detached daemon worker can't get the macOS Reminders TCC grant, so background
agents using the Apple integration's reminder tools were denied. The new
`sua worker install-launchagent` writes a user LaunchAgent that runs the worker
in your GUI login session (via `launchctl bootstrap gui/$UID`), where macOS can
surface the permission prompt and persist the grant across reboots — so
scheduled/temporal reminder agents work. Paired with `uninstall-launchagent` and
`launchagent-status`. The fully distributable fix (code-signing the runner) is
captured in ADR-0026.
