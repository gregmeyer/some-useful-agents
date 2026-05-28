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

import { parseAgent, type AgentStore, type InboxStore } from '@some-useful-agents/core';

/**
 * Stub YAML for `demo-failing-agent`. The Inbox demo seed references
 * this agent by id; when triage proposes running agent-analyzer on
 * the failing-run message, the inbox route exports this agent's YAML
 * as AGENT_YAML input. Without it, the action runs with a missing
 * required input and fails immediately.
 *
 * The YAML deliberately uses an invalid tool reference (`shell-exec`)
 * so agent-analyzer has a real failure to diagnose — matches the
 * demo message body ("shell-exec: command not found").
 */
const DEMO_FAILING_AGENT_YAML = [
  'id: demo-failing-agent',
  'name: Demo failing agent',
  'description: Sample agent that fails with exit 1 — used by the inbox demo.',
  'source: examples',
  'nodes:',
  '  - id: greet',
  '    type: shell',
  '    command: echo hello',
  '  - id: fail',
  '    type: shell',
  '    command: shell-exec ls',
  '    dependsOn: [greet]',
].join('\n');

export function seedInboxDemoIfRequested(
  store: InboxStore | undefined,
  agentStore?: AgentStore,
): void {
  if (!store) return;
  if (process.env.SUA_INBOX_DEMO !== '1') return;

  // Install the demo failing agent so triage's action-loop can
  // actually run agent-analyzer on it. Idempotent — upsertAgent
  // skips when the YAML hasn't changed.
  if (agentStore && !agentStore.getAgent('demo-failing-agent')) {
    try {
      const parsed = parseAgent(DEMO_FAILING_AGENT_YAML);
      agentStore.upsertAgent(parsed, 'import', 'Inbox demo seed');
    } catch (err) {
      process.stderr.write(
        `[inbox-demo-seed] could not install demo-failing-agent: ${(err as Error)?.message ?? String(err)}\n`,
      );
    }
  }

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
