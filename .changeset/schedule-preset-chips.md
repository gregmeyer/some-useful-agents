---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

dashboard: schedule preset chips on agent → Config → Schedule

The cron input stays as the source of truth, but a row of preset chips
(Every 5m, Every 15m, Hourly, Daily 8am, Weekdays 9am, Mon 9am, Disable)
sits above it. Click a chip to fill the input. The chip matching the
current value highlights so it's obvious which preset is active. Typing
a custom expression still works and the existing English preview
("Currently: Every day at 8:00 AM") validates the result.
