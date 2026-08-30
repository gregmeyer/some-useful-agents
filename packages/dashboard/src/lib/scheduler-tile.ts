import type { SchedulerStatus } from '@some-useful-agents/core';

export interface SchedulerTileState {
  /** Feeds the `status` template's dot: ok -> green, warn -> amber, else red. */
  state: 'ok' | 'warn' | 'down';
  label: string;
  message: string;
}

/**
 * Map scheduler health onto the Pulse status tile.
 *
 * Pure so it can be tested without a running daemon or a heartbeat file —
 * the states that matter most are the ones you cannot conveniently reproduce
 * by hand.
 *
 * The scheduler died on 2026-08-18 and stayed dead for nine days with agents
 * on cron. `/health` knew and `/scheduled` said so in its header, but that is
 * the page you only open once you already suspect something. This puts it on
 * the board people actually look at.
 *
 * Red is reserved for the case that actually costs the user something: agents
 * are scheduled and nothing will fire them. Amber covers the merely odd — a
 * scheduler that is off with nothing to run, or one that is alive but
 * registered nothing, which is its own silent failure ("running" while firing
 * nothing is arguably worse than being visibly off).
 */
export function schedulerTileState(input: {
  status: SchedulerStatus;
  /** Agents the daemon actually registered, per its heartbeat. */
  registered: number;
  /** Agents that SHOULD be registered: scheduled and active. */
  scheduled: number;
}): SchedulerTileState {
  const { status, registered, scheduled } = input;

  const label = status === 'running' ? 'Running'
    : status === 'idle' ? 'Idle'
    : status === 'stale' ? 'Stale'
    : 'Stopped';

  if (scheduled === 0) {
    // Nothing to run, so a stopped scheduler is not a problem to solve.
    return { state: 'warn', label, message: 'No agents on a schedule' };
  }

  if (status === 'running') {
    // Trust the heartbeat's own count when we have it; it is what the daemon
    // really picked up, and a mismatch with `scheduled` is worth showing.
    const n = registered || scheduled;
    return {
      state: 'ok',
      label,
      message: `${String(n)} agent${n === 1 ? '' : 's'} on a schedule`,
    };
  }

  if (status === 'idle') {
    return {
      state: 'warn',
      label,
      message: `Registered no agents, but ${String(scheduled)} ${scheduled === 1 ? 'is' : 'are'} scheduled`,
    };
  }

  return {
    state: 'down',
    label,
    message: `${String(scheduled)} scheduled agent${scheduled === 1 ? '' : 's'} will not run`,
  };
}
