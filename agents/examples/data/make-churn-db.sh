#!/usr/bin/env bash
# Regenerate the seed SQLite file used by the churn-watcher example.
# Idempotent: deletes the file first, then re-seeds. Safe to run from
# any working directory — writes alongside this script.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB="$HERE/churn-customers.db"

rm -f "$DB"

sqlite3 "$DB" <<'SQL'
CREATE TABLE customers (
  id          INTEGER PRIMARY KEY,
  email       TEXT NOT NULL,
  status      TEXT NOT NULL,                       -- 'active' | 'churned'
  plan        TEXT NOT NULL,                       -- 'free' | 'pro' | 'team'
  signed_up   DATE NOT NULL,
  churned_at  TIMESTAMP,                           -- nullable; NULL for active
  reason      TEXT                                 -- free-form when churned
);

INSERT INTO customers (email, status, plan, signed_up, churned_at, reason) VALUES
  ('amy@example.com',     'active',  'pro',  '2025-11-04', NULL, NULL),
  ('ben@example.com',     'active',  'team', '2024-08-21', NULL, NULL),
  ('chris@example.com',   'active',  'free', '2026-01-10', NULL, NULL),
  ('dana@example.com',    'active',  'pro',  '2025-06-18', NULL, NULL),
  ('eve@example.com',     'active',  'pro',  '2024-12-02', NULL, NULL),
  ('frank@example.com',   'churned', 'pro',  '2025-03-15', '2026-05-09T14:22:00Z', 'pricing'),
  ('grace@example.com',   'churned', 'free', '2025-09-30', '2026-05-10T08:05:00Z', 'no longer needed'),
  ('henry@example.com',   'churned', 'team', '2024-11-11', '2026-05-12T19:40:00Z', 'switched to competitor'),
  ('iris@example.com',    'churned', 'pro',  '2025-07-22', '2026-05-13T03:11:00Z', 'integration gaps');
SQL

echo "Wrote $DB"
