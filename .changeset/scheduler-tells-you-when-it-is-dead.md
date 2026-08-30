---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

The scheduler now tells you when it is dead.

On the install this was found on, the schedule daemon had been stopped for nine days behind a stale
pidfile. Eighteen agents had cron expressions and none of them fired. Nothing a person would
normally look at said so: `/health` knew, and `/scheduled` mentioned it in its page header, but that
is the page you only open once you already suspect something. Home and the board said nothing, and
`sua doctor` printed **"All checks passed"** the entire time.

**Pulse gains a scheduler tile.** Red when agents are scheduled and nothing will fire them — the
case that actually costs you runs. Amber for the merely odd: the daemon off with nothing scheduled,
or alive but registered zero agents, which is worse than being visibly off because it reads as fine
and never fires. It uses the existing `status` template, so there is no new tile machinery.

**`sua doctor` stops certifying a broken install.** Three checks were lying:

- **Scheduler** only checked that `node-cron` could be imported — true throughout the outage. It now
  reports whether the daemon is running, and fails with the command to start it when agents are
  scheduled and it is not.
- **Scheduled agents** reported `none` while seven v2 agents were scheduled, because it used
  `loadAgents`, the v1 loader that silently skips every v2 agent (ADR-0032). It now counts both.
- **Agent secrets** said "no agents declare secrets" for the same reason; v2 agents declare secrets
  per node. It now counts those too.

That is the fifth and sixth consumer bitten by the v1-loader trap ADR-0032 documented.

Also removes `views/home-widgets.ts` — 414 lines with **zero importers**, orphaned when the home
became the cadence inbox feed. It contained a scheduler status widget with heartbeat staleness
detection that nobody could see, which is a large part of why the outage went unnoticed. The Pulse
tile replaces it on a surface that is actually rendered.
