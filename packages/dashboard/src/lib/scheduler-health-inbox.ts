/**
 * Scheduler-down inbox producer — the first `system-health` source.
 *
 * A dead scheduler is the quietest failure sua has: nothing runs, so nothing
 * fails, so no `run-failure` thread ever opens. It went unnoticed for 9 days
 * once and 12 days again. This loop checks the scheduler heartbeat and posts
 * ONE high-priority thread when the scheduler crashed, then resolves it with a
 * system note once a scheduler is heartbeating again.
 *
 * "Crashed" is deliberately narrow, to stay quiet on intentional stops and on
 * laptop sleep:
 *   - status `stale` (heartbeat file left behind) — a clean `sua schedule
 *     stop` removes the file, which reads as `stopped` and posts nothing;
 *   - older than DOWN_AFTER_MS, not the 90s status threshold — after a wake,
 *     the dashboard may tick before the scheduler rewrites its heartbeat;
 *   - the heartbeat's pid is dead — a live pid means asleep/busy, not down;
 *   - at least one agent was scheduled — an empty scheduler losing nothing.
 *
 * Shape mirrors daily-digest.ts: pure builder → AddMessageInput, a
 * once-function for tests, and a setInterval + unref + stop-fn loop.
 * Idempotency is the dedupeKey (one thread per crashed scheduler instance).
 */
import {
  getSchedulerStatus,
  type AddMessageInput,
  type InboxMessage,
  type InboxStore,
  type SchedulerHeartbeat,
} from '@some-useful-agents/core';

/** How long the heartbeat must be silent before it counts as down. */
export const DOWN_AFTER_MS = 5 * 60 * 1000;
/** Loop cadence. */
export const SCHEDULER_HEALTH_INTERVAL_MS = 60 * 1000;
/** dedupeKey prefix; the crashed instance's startedAt is appended. */
export const SCHEDULER_DOWN_DEDUPE_PREFIX = 'system-health:scheduler-down:';

function formatAge(ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'}`;
  const hours = Math.floor(min / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

/** Build the inbox message for a crashed scheduler. Pure; exported for tests. */
export function buildSchedulerDownMessage(heartbeat: SchedulerHeartbeat, now = Date.now()): AddMessageInput {
  const silentFor = formatAge(now - new Date(heartbeat.lastHeartbeat).getTime());
  const agents = [...heartbeat.agents].sort();
  const shown = agents.slice(0, 10).map((a) => `\`${a}\``).join(', ');
  const more = agents.length > 10 ? ` and ${agents.length - 10} more` : '';
  return {
    priority: 'high',
    source: 'system-health',
    title: 'Scheduler is down — scheduled agents are not running',
    body: [
      `The scheduler (pid ${heartbeat.pid}) stopped without shutting down cleanly. Its last heartbeat was ${silentFor} ago.`,
      '',
      `Scheduled agents that are not firing (${agents.length}): ${shown}${more}.`,
      '',
      'Restart it with `sua daemon start --service schedule` (or `sua schedule start` in a terminal).',
      'Missed runs catch up once it is back. `sua daemon logs schedule` shows what it last did.',
      '',
      'This thread resolves itself when the scheduler is heartbeating again.',
    ].join('\n'),
    dedupeKey: `${SCHEDULER_DOWN_DEDUPE_PREFIX}${heartbeat.startedAt}`,
  };
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export interface SchedulerHealthOpts {
  now?: number;
  /** Injected for tests. */
  isAlive?: (pid: number) => boolean;
  /** Publish hook so the inbox UI updates live (injected; keeps routes/ out). */
  onChanged?: (message: InboxMessage) => void;
}

export type SchedulerHealthOutcome = 'posted' | 'resolved' | 'none';

/** One check. Never throws for a missing/unreadable heartbeat (that's `stopped`). */
export function checkSchedulerHealthOnce(
  inboxStore: InboxStore,
  dataDir: string,
  opts: SchedulerHealthOpts = {},
): SchedulerHealthOutcome {
  const now = opts.now ?? Date.now();
  const isAlive = opts.isAlive ?? isProcessAlive;
  const { status, heartbeat } = getSchedulerStatus(dataDir);

  if (status === 'stale' && heartbeat) {
    const silentMs = now - new Date(heartbeat.lastHeartbeat).getTime();
    if (silentMs < DOWN_AFTER_MS || heartbeat.agents.length === 0 || isAlive(heartbeat.pid)) return 'none';
    const input = buildSchedulerDownMessage(heartbeat, now);
    if (inboxStore.findByDedupeKey(input.dedupeKey!)) return 'none';
    const message = inboxStore.add(input);
    opts.onChanged?.(message);
    return 'posted';
  }

  if (status === 'running' || status === 'idle') {
    let resolved = false;
    const open = inboxStore.list({ source: 'system-health', limit: 50 })
      .filter((m) => m.dedupeKey?.startsWith(SCHEDULER_DOWN_DEDUPE_PREFIX)
        && m.status !== 'resolved' && m.status !== 'dismissed');
    for (const m of open) {
      inboxStore.addResponse(m.id, 'system', `Scheduler is running again (pid ${heartbeat?.pid ?? '?'}).`);
      inboxStore.updateStatus(m.id, 'resolved', { autoResolved: true });
      const updated = inboxStore.get(m.id);
      if (updated) opts.onChanged?.(updated);
      resolved = true;
    }
    return resolved ? 'resolved' : 'none';
  }

  return 'none';
}

/** Start the periodic check. Returns a stop function for `close()`. */
export function startSchedulerHealthInbox(
  inboxStore: InboxStore,
  dataDir: string,
  opts: Pick<SchedulerHealthOpts, 'onChanged'> = {},
): () => void {
  const tick = () => {
    try {
      checkSchedulerHealthOnce(inboxStore, dataDir, opts);
    } catch (err) {
      console.warn('[scheduler-health] check failed:', err instanceof Error ? err.message : String(err));
    }
  };
  tick();
  const timer = setInterval(tick, SCHEDULER_HEALTH_INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
