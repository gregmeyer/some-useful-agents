---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Add an owner-authorized Apple Reminders & Notes integration (experimental, macOS-only, default off).

A new `apple` integration kind lets agents create/read reminders and create/read
notes on the owner's Mac. It compiles a tiny Swift runner on demand (EventKit for
Reminders, AppleScript for Notes) — the same compile-on-demand pattern as the
Apple Foundation Models provider. Saving the integration in the dashboard
generates `apple.<slug>.reminder-create` / `reminder-read` / `reminder-update` /
`note-create` / `note-read` tools.

The engine ships dormant: the `apple` kind, its tools, and the dashboard tab stay
hidden until the owner enables `experimental.apple` in `sua.config.json` (or sets
`SUA_EXPERIMENTAL_APPLE=1`). A new `sua apple authorize` command triggers the macOS
permission prompts from a foreground Terminal so the first grant isn't swallowed by
a headless daemon. Notes is best-effort (no first-party API). Off macOS the tools
fail with a clear macOS-only error.
