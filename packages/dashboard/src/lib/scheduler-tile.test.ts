/**
 * The scheduler tile's state mapping.
 *
 * These are the cases nobody can conveniently reproduce by hand — a stale
 * heartbeat, a daemon that is alive but registered nothing — which is exactly
 * why the nine-day outage went unseen. Pure function, so they are all cheap.
 */

import { describe, it, expect } from 'vitest';
import { schedulerTileState } from './scheduler-tile.js';

describe('schedulerTileState', () => {
  it('is green when the daemon is running and has agents', () => {
    const r = schedulerTileState({ status: 'running', registered: 7, scheduled: 7 });
    expect(r.state).toBe('ok');
    expect(r.label).toBe('Running');
    expect(r.message).toBe('7 agents on a schedule');
  });

  // The failure that actually cost nine days of missed runs.
  it('is red when the daemon is stopped and agents are scheduled', () => {
    const r = schedulerTileState({ status: 'stopped', registered: 0, scheduled: 7 });
    expect(r.state).toBe('down');
    expect(r.label).toBe('Stopped');
    expect(r.message).toBe('7 scheduled agents will not run');
  });

  it('is red when the heartbeat has gone stale', () => {
    const r = schedulerTileState({ status: 'stale', registered: 0, scheduled: 3 });
    expect(r.state).toBe('down');
    expect(r.label).toBe('Stale');
    expect(r.message).toContain('will not run');
  });

  // "Running" while firing nothing is arguably worse than being visibly off:
  // the status word says fine and no runs ever appear.
  it('is amber when the daemon is alive but registered nothing', () => {
    const r = schedulerTileState({ status: 'idle', registered: 0, scheduled: 4 });
    expect(r.state).toBe('warn');
    expect(r.label).toBe('Idle');
    expect(r.message).toContain('Registered no agents');
    expect(r.message).toContain('4');
  });

  it('does not cry wolf when nothing is scheduled', () => {
    for (const status of ['stopped', 'stale', 'idle'] as const) {
      const r = schedulerTileState({ status, registered: 0, scheduled: 0 });
      expect(r.state).toBe('warn');
      expect(r.message).toBe('No agents on a schedule');
    }
  });

  it('reports the heartbeat count when it disagrees with what should be scheduled', () => {
    // A mismatch is worth showing rather than smoothing over: it means the
    // daemon is running against a different view of the agents than we are.
    const r = schedulerTileState({ status: 'running', registered: 2, scheduled: 7 });
    expect(r.state).toBe('ok');
    expect(r.message).toBe('2 agents on a schedule');
  });

  it('falls back to the scheduled count when the heartbeat carries none', () => {
    const r = schedulerTileState({ status: 'running', registered: 0, scheduled: 5 });
    expect(r.message).toBe('5 agents on a schedule');
  });

  it('says agent, singular, for one', () => {
    expect(schedulerTileState({ status: 'running', registered: 1, scheduled: 1 }).message)
      .toBe('1 agent on a schedule');
    expect(schedulerTileState({ status: 'stopped', registered: 0, scheduled: 1 }).message)
      .toBe('1 scheduled agent will not run');
  });
});
