---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Fix node-cron type import so the build survives the 4.5.0 bump.

node-cron 4.5.0 ships a bundled type declaration whose default export no
longer doubles as a type namespace, so `cron.ScheduledTask` stopped
resolving (`TS2503: Cannot find namespace 'cron'`). Import `ScheduledTask`
as a named type instead. Backward compatible with 4.2.1; unblocks the
Dependabot prod-minor-patch bump.
