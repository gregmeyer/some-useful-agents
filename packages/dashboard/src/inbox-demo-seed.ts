/**
 * Demo seed for the Inbox MVP. When `SUA_INBOX_DEMO=1` is set at boot
 * and the inbox is empty, seeds one row at each priority so the UI
 * surface is visible before real producers (failed-run hook,
 * CSP-block escalation, cadence agent) ship.
 *
 * This file disappears when PR 3 lands and real producers populate the
 * inbox. Intentionally tiny + non-magical: no scheduler, no random
 * data, no recurring inserts.
 */

import type { InboxStore } from '@some-useful-agents/core';

export function seedInboxDemoIfRequested(store: InboxStore | undefined): void {
  if (!store) return;
  if (process.env.SUA_INBOX_DEMO !== '1') return;
  // Only seed if empty so daemon restarts don't accumulate duplicates
  // (dedupe_key would catch them anyway, but the empty-check makes
  // the intent explicit).
  if (store.list().length > 0) return;

  try {
    store.add({
      priority: 'high',
      source: 'run-failure',
      agentId: 'demo-failing-agent',
      runId: 'demo-run-1',
      title: 'demo-failing-agent failed: exit code 1',
      body: 'The most recent run of demo-failing-agent terminated with a non-zero exit code. Diagnose the failure and either fix the agent or mark this resolved.',
      contextJson: JSON.stringify({ exitCode: 1, durationMs: 4321, lastErrorLine: 'shell-exec: command not found' }),
      dedupeKey: 'demo:run-failure',
    });
    store.add({
      priority: 'medium',
      source: 'permission-request',
      agentId: 'demo-astro-tile',
      title: 'demo-astro-tile wants to load images from apod.nasa.gov',
      body: 'A widget on demo-astro-tile has tried to load images from apod.nasa.gov 4 times in the last hour and been blocked by the page CSP. Add the host to its allowlist or dismiss to hide this reminder.',
      contextJson: JSON.stringify({ host: 'apod.nasa.gov', blockedCount: 4 }),
      dedupeKey: 'demo:csp-block',
    });
    store.add({
      priority: 'low',
      source: 'cadence',
      title: '3 agents have not run in 30+ days',
      body: 'Housekeeping reminder: stock-ticker, weather-archive, and cron-test-old have not produced runs in the last 30 days. Archive them or trigger a fresh run to confirm they still work.',
      contextJson: JSON.stringify({ staleAgents: ['stock-ticker', 'weather-archive', 'cron-test-old'] }),
      dedupeKey: 'demo:cadence',
    });
  } catch (err) {
    // Demo seed failures are non-fatal — the page will just render
    // an empty state. Log to stderr so an operator inspecting
    // dashboard.log knows the seed ran but skipped.
    process.stderr.write(
      `[inbox-demo-seed] failed: ${(err as Error)?.message ?? String(err)}\n`,
    );
  }
}
