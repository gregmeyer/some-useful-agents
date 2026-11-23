---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

New `sua backups prune` deletes old database backups.

It keeps the newest 5 backup sets (`*.db.bak-YYYYMMDD-HHMMSS`), plus the newest set from each of the last 7 days, in the data dir and `~/.sua`. A backup with any other name is never deleted. `--dry-run` shows what it would remove, and `--keep-last` and `--keep-days` change the counts. The repo now has `scripts/live-update.sh`, which updates an install that runs from a checkout and then prunes. Before, backups were never pruned and filled 120 GB in seven weeks.
