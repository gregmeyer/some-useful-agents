---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Apple Notes: fail fast instead of hanging 30s when the worker lacks a GUI session.

`note-create`/`note-read`/`lists` drive Notes.app via AppleScript. From a process
without a GUI session or Automation grant (e.g. the background temporal worker),
the Apple event blocks until the 30s spawn timeout ("produced no output"). The
runner now wraps every AppleScript in `with timeout of 10 seconds` and maps the
timeout (-1712) and not-permitted (-1743) errors to clear, actionable messages
("run it via sua worker install-launchagent", or "grant Automation access").
