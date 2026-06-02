#!/usr/bin/env bash
#
# temporal-up.sh — bring up the full Temporal stack in the order the worker
# model expects: the Temporal server (Docker), then the daemon-managed dashboard
# + MCP server + worker, all on the `temporal` provider.
#
# The Temporal SERVER runs in Docker; the WORKER runs on the host (it executes
# your shell + `claude`, see docs/adr/0004-temporal-worker-on-host.md). This
# script wires both up so v2 DAG agents run on Temporal end-to-end.
#
# Usage:
#   ./scripts/temporal-up.sh            # build if needed, start everything
#   SKIP_BUILD=1 ./scripts/temporal-up.sh
#
set -euo pipefail
cd "$(dirname "$0")/.."

# Prefer a `sua` on PATH; fall back to the freshly built local CLI.
if command -v sua >/dev/null 2>&1; then
  SUA="sua"
else
  SUA="node packages/cli/dist/index.js"
fi

echo "==> Starting Temporal server (Docker)…"
docker compose up -d

echo "==> Waiting for Temporal to be healthy…"
for i in $(seq 1 30); do
  if docker exec sua-temporal temporal operator cluster health --address sua-temporal:7233 >/dev/null 2>&1; then
    echo "    Temporal is SERVING."
    break
  fi
  if [ "$i" = "30" ]; then
    echo "    Temporal did not become healthy in time. Check: docker compose logs temporal" >&2
    exit 1
  fi
  sleep 2
done

if [ "${SKIP_BUILD:-}" != "1" ]; then
  echo "==> Building the CLI…"
  npm run build >/dev/null
fi

echo "==> Starting daemon services (dashboard, mcp, worker) on the temporal provider…"
# SUA_PROVIDER makes the dashboard + mcp children resolve the temporal provider;
# the worker reads its Temporal connection from config/env regardless.
export SUA_PROVIDER=temporal
$SUA daemon start --service dashboard --service mcp --service worker

DASH_PORT="${SUA_DASHBOARD_PORT:-3000}"
TOKEN_FILE="${HOME}/.sua/mcp-token"
echo
echo "==> Up."
if [ -f "$TOKEN_FILE" ]; then
  echo "    Dashboard sign-in: http://127.0.0.1:${DASH_PORT}/auth#token=$(cat "$TOKEN_FILE")"
else
  echo "    Dashboard: http://127.0.0.1:${DASH_PORT}/  (run '$SUA daemon status' for the sign-in URL)"
fi
echo "    Temporal UI:       http://localhost:8233"
echo
echo "Status: $SUA daemon status        Stop: ./scripts/temporal-down.sh"
