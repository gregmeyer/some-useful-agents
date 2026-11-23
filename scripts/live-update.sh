#!/usr/bin/env bash
# Update a live sua install (a checkout of main) to origin/main: refuse while
# work is running, back up the databases, fast-forward, clean build, prune old
# backups and logs, restart the daemon.
#
# Usage: scripts/live-update.sh [--force]   (--force rebuilds even when already current)
#   SUA_REPO=/path/to/checkout   the install to update (default: this script's checkout)
#
# Backups are kept by `sua backups prune` (newest 5 sets, plus the newest of
# each of the last 7 days); a backup with any other name is never deleted.
set -euo pipefail

# One block: bash parses all of it before running any, so the fast-forward
# below can change this file without changing the run in progress.
{

REPO="${SUA_REPO:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$REPO"
sua() { node "$REPO/packages/cli/dist/index.js" "$@"; }

say() { printf '%s\n' "$*"; }
die() { printf 'live-update: %s\n' "$*" >&2; exit 2; }

# 1. Nothing in flight: a restart would cut off runs and notebook steps.
runs=$(sqlite3 data/runs.db "SELECT COUNT(*) FROM runs WHERE status IN ('running','pending','queued');")
steps=$(sqlite3 data/runs.db "SELECT COUNT(*) FROM notebooks n, json_each(COALESCE(n.steps_json,'[]')) s WHERE json_extract(s.value,'\$.status') = 'running';")
[ "$runs" = 0 ] && [ "$steps" = 0 ] || die "not updating: $runs run(s) and $steps notebook step(s) in progress. Wait or stop them, then try again."

# 2. The live checkout is main with no local edits (package-lock churn from npm ci is reset).
[ "$(git branch --show-current)" = main ] || die "the live checkout is on '$(git branch --show-current)', not main."
git checkout -- package-lock.json 2>/dev/null || true
git diff --quiet && git diff --cached --quiet || { git status --short >&2; die "the live checkout has uncommitted changes."; }

# 3. Anything new?
git fetch -q origin
before=$(git rev-parse --short HEAD)
after=$(git rev-parse --short origin/main)
if [ "$before" = "$after" ] && [ "${1:-}" != --force ]; then say "Already on $after. Nothing to do."; exit 0; fi
git merge-base --is-ancestor HEAD origin/main || die "main has commits that aren't on origin/main; not fast-forwarding."

# 4. Back up the databases.
ts=$(date +%Y%m%d-%H%M%S)
for f in data/runs.db data/sua.db "$HOME/.sua/sua.db"; do
  [ -f "$f" ] && sqlite3 "$f" ".backup '$f.bak-$ts'"
done
say "Backups: *.db.bak-$ts"

# 5. Fast-forward, install, clean build.
git merge -q --ff-only origin/main
say "Updated $before → $after:"
git log --oneline "$before..$after" | sed 's/^/  /'
npm ci --silent
# A Playwright update needs its own Chromium build (brief PDFs, screenshots); nothing to do when it's there.
npx playwright install chromium > /dev/null 2>&1 || say "Note: couldn't fetch Playwright's Chromium; PDFs and screenshots may fall back until 'npx playwright install chromium' succeeds."
find packages -maxdepth 2 \( -name dist -o -name '*.tsbuildinfo' \) -not -path '*/node_modules/*' -exec rm -rf {} +
log="data/daemon/logs/live-update-$ts.log"
if ! npm run build > "$log" 2>&1; then
  tail -20 "$log" >&2
  die "build failed (full log: $log). The daemon was NOT restarted. To go back: git reset --hard $before && npm ci && npm run build && sua daemon restart"
fi

# 6. Old backups and update logs go (the newest are kept).
sua backups prune || say "Note: couldn't prune old backups; see 'sua backups prune --dry-run'."
ls -1t data/daemon/logs/live-update-*.log 2>/dev/null | tail -n +21 | while IFS= read -r f; do rm -f -- "$f"; done

# 7. Restart and show where it stands.
sua daemon restart
sleep 5
sua daemon status
exit 0
}
