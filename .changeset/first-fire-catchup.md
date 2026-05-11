---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Scheduled agents fire their first window on daemon start, even with no prior `triggered_by='schedule'` run.

Freshly registered scheduled agents used to silently skip their first window: `hasMissedFire(expr, undefined)` returned `false` for any agent that had never fired on schedule before, so the daemon's start-up catch-up logic skipped them. Manual fires (`triggered_by='cli'|'dashboard'`) didn't count toward seeding. Net effect: installing `daily-greeting` at 10 AM and starting the daemon meant nothing fired until 8 AM **the next day** — and only then because that fire seeded the catch-up for future windows.

Now: when `since` is undefined, catch up if the most recent past cron tick is within the past 24 hours. Daily/hourly/sub-day crons fire on first daemon start as users expect. Weekly/monthly/yearly crons whose most recent tick is older than 24h aren't surprise-fired on daemon restart.
