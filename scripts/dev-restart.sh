#!/usr/bin/env bash
#
# dev-restart.sh — rebuild the workspace and restart the daemon so the running
# services serve the code you just checked out / edited.
#
# This exists because `sua daemon start` does NOT do what people expect:
#   - it never rebuilds (start/restart just spawn whatever is in dist/), and
#   - `start` is a no-op when a service is already running (duplicate-safe),
#     so it silently leaves you on the OLD code.
# The fix-current-code sequence is always: build, THEN restart.
#
# Confirm you're current by checking the footer SHA (sua v.. · <sha>) matches
# `git rev-parse --short HEAD`. A "-dirty" suffix just means uncommitted changes.
#
# Usage:
#   ./scripts/dev-restart.sh              # build, then restart the daemon
#   SKIP_BUILD=1 ./scripts/dev-restart.sh # restart only (already built)
#   CLEAN=1 ./scripts/dev-restart.sh      # nuke dist + tsbuildinfo first
#
set -euo pipefail
cd "$(dirname "$0")/.."

# Prefer a `sua` on PATH; fall back to the freshly built local CLI.
if command -v sua >/dev/null 2>&1; then
  SUA="sua"
else
  SUA="node packages/cli/dist/index.js"
fi

if [ "${CLEAN:-}" = "1" ]; then
  echo "==> Clean (rm dist + tsbuildinfo)…"
  rm -rf packages/*/dist packages/*/*.tsbuildinfo
fi

if [ "${SKIP_BUILD:-}" != "1" ]; then
  echo "==> Building…"
  npm run build >/dev/null
fi

# Restart services one at a time. A single `daemon restart` brings them all up
# concurrently, and the schedule/worker/dashboard race to open the SQLite store
# ("Could not start the temporal provider: database is locked"). Staggering with
# a brief pause sidesteps the WAL open race; dashboard goes last so the port is
# free by the time it binds.
echo "==> Restarting daemon services (staggered to avoid the SQLite open race)…"
for svc in schedule worker dashboard; do
  $SUA daemon restart --service "$svc" 2>&1 | sed 's/^/    /'
  sleep 1
done

echo
$SUA daemon status

DASH_PORT="${SUA_DASHBOARD_PORT:-3000}"
TOKEN_FILE="${HOME}/.sua/mcp-token"
echo
echo "==> Running commit: $(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
echo "    Verify the footer SHA on any page matches the above."
if [ -f "$TOKEN_FILE" ]; then
  echo "    Sign-in: http://127.0.0.1:${DASH_PORT}/auth#token=$(cat "$TOKEN_FILE")"
fi
