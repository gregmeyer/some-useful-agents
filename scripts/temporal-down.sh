#!/usr/bin/env bash
#
# temporal-down.sh — tear down what temporal-up.sh started.
#
# Stops the daemon-managed services (dashboard, mcp, worker), then stops the
# Temporal Docker containers. Postgres data is preserved (use `docker compose
# down -v` by hand to wipe workflow history).
#
# Usage:
#   ./scripts/temporal-down.sh           # stop daemon services + Temporal containers
#   KEEP_DOCKER=1 ./scripts/temporal-down.sh   # stop daemon services only
#
set -euo pipefail
cd "$(dirname "$0")/.."

if command -v sua >/dev/null 2>&1; then
  SUA="sua"
else
  SUA="node packages/cli/dist/index.js"
fi

echo "==> Stopping daemon services (dashboard, mcp, worker)…"
$SUA daemon stop --service dashboard --service mcp --service worker || true

if [ "${KEEP_DOCKER:-}" != "1" ]; then
  echo "==> Stopping Temporal containers (data preserved)…"
  docker compose stop
fi

echo "==> Down."
