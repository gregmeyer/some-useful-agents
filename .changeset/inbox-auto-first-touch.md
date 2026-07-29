---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Autonomous first-touch triage (opt-in): new inbox items get analyzed without a human poke.

Until now a run-failure inbox item sat `open` and inert until the operator opened the thread and clicked "Ask triage." With `SUA_INBOX_AUTO_TRIAGE=1` (or `experimental.inboxAutoTriage: true` in `sua.config.json`), the inbox closes that gap on its own: producers kick a triage turn the moment they raise an item, and a 30s background sweeper (the durable path) picks up anything the kick missed — items created while the dashboard was down, or stranded by a crash between insert and kick. Manual threads are never auto-touched; the operator still owns that kickoff.

Autonomy stays bounded: at most 3 first-touches per sweep, a global ceiling of 3 concurrent triage runs for the autonomous paths, and all existing engine guards (per-thread turn cap, action cap, one-write-per-turn, operator Stop) apply unchanged. Default off in this release; the default is planned to flip once durable recovery and the local-failure producer land.
